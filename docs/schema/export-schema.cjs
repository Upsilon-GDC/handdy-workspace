// Documentation only: load model definitions without .env, server startup,
// connection calls, queries, or evaluating default-value functions.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const mongoose = require(path.join(root, 'backend/node_modules/mongoose'));
const purposes = {
  Employee: 'Employee identities, authentication hashes, team membership, billing rates and individual permissions/idle policy.',
  Team: 'Teams and their primary team lead.',
  Client: 'Business clients; these are not authenticated user accounts.',
  Project: 'Projects, client/team availability, linked tasks and activity-selection settings.',
  Task: 'Work/break tasks, team/employee assignment and soft deletion.',
  TaskTimeLog: 'Live and completed timer sessions, pauses, totals, manual entries and retry identities.',
  Attendance: 'Daily attendance derived from time entries, with retained historical check-in rows and productivity adjustments.',
  Shift: 'Shift templates, timezone, hours and embedded break definitions.',
  Schedule: 'Employee/team/shift assignments by business day.',
  AuthSession: 'Device authentication sessions and active desktop-session uniqueness.',
  DeviceLoginRequest: 'Second-device approval requests and their cleanup lifecycle.',
  RolePermission: 'Saved permission sets for configurable roles.',
  SystemSettings: 'Global idle policy and optional default activity configuration.',
  ActivityMapping: 'Unique project/client/task activity tuples.',
  ActivityLinkChange: 'Activity-link/unlink audit snapshots.',
  ClientAccessPolicy: 'Team/employee client limits and extra work-team/project grants.',
  ClientAccessChange: 'Batch access-policy audit snapshots.',
  TimeEntryEdit: 'Administrative correction revisions and before/after snapshots.',
  WorkingHoursPolicy: 'Effective-dated per-employee working-hours requirements.',
};
const jsonValue = value => JSON.parse(JSON.stringify(value, (_key, val) => val instanceof RegExp ? val.toString() : typeof val === 'function' ? val.toString() : val));
const optional = value => value === undefined ? undefined : jsonValue(value);
function describeDefault(field) {
  const opts = field.options;
  if (Object.hasOwn(opts, 'default')) {
    if (opts.default === undefined) return { kind: 'unset', explicit: true };
    if (typeof opts.default === 'function') return { kind: 'function', expression: opts.default === Date.now ? 'Date.now()' : opts.default.toString() };
    return { kind: 'value', value: jsonValue(opts.default) };
  }
  if (opts.auto && field.instance === 'ObjectId') return { kind: 'generated', expression: 'ObjectId' };
  if (field.instance === 'Array' && typeof field.defaultValue === 'function') return { kind: 'value', value: [], implicit: true };
  return { kind: 'unset' };
}
function fieldsFor(schema, prefix = '', inheritedHidden = false) {
  const rows = [];
  schema.eachPath((name, field) => {
    const opts = field.options;
    const element = field.getEmbeddedSchemaType?.() || field.embeddedSchemaType || field.$embeddedSchemaType || field.caster;
    const documentArray = Boolean(field.$isMongooseDocumentArray);
    const type = documentArray ? 'Embedded[]' : field.schema ? 'Embedded' : field.instance === 'Array' ? `${element?.instance || 'Mixed'}[]` : field.instance;
    const hidden = inheritedHidden || opts.select === false;
    const validators = (field.validators || []).map(v => ({ type: v.type || 'custom', message: typeof v.message === 'function' ? '[message function]' : v.message,
      ...(v.type === 'user defined' ? { expression: v.validator.toString() } : {}) }));
    const constraints = {};
    for (const key of ['min', 'max', 'minlength', 'maxlength', 'match', 'trim', 'lowercase', 'uppercase', 'immutable', 'unique', 'sparse']) {
      if (opts[key] !== undefined) constraints[key] = optional(opts[key]);
    }
    const enumValues = field.enumValues?.length ? field.enumValues : element?.enumValues;
    if (enumValues?.length) constraints.enum = optional(enumValues);
    rows.push({ path: prefix + name, type, required: Boolean(field.isRequired), default: describeDefault(field),
      hiddenByDefault: hidden, ...(opts.ref || element?.options?.ref ? { ref: opts.ref || element.options.ref } : {}),
      ...(field.schema ? { embeddedId: Boolean(field.schema.options._id) } : {}), constraints, validators });
    if (field.schema) rows.push(...fieldsFor(field.schema, `${prefix}${name}${documentArray ? '[]' : ''}.`, hidden));
  });
  return rows;
}

const files = fs.readdirSync(path.join(root, 'backend/src/models')).filter(file => file.endsWith('.js')).sort();
const models = files.map(file => {
  const Model = require(path.join(root, 'backend/src/models', file));
  return { model: Model.modelName, collection: Model.collection.collectionName, source: `backend/src/models/${file}`,
    purpose: purposes[Model.modelName], schemaOptions: { timestamps: Boolean(Model.schema.options.timestamps), strict: Model.schema.options.strict,
      versionKey: Model.schema.options.versionKey, autoCreate: optional(Model.schema.options.autoCreate), autoIndex: optional(Model.schema.options.autoIndex) },
    fields: fieldsFor(Model.schema), indexes: Model.schema.indexes().map(([keys, options]) => ({ keys: jsonValue(keys), options: jsonValue(options) })) };
});
if (mongoose.connection.readyState !== 0) throw Error('Schema documentation must not connect to a database.');
const permissions = require(path.join(root, 'backend/src/utils/permissions'));
const result = { scope: 'Current workspace Mongoose definitions; not a live database inspection', connection: 'MONGODB_URI (value not read)',
  modelCount: models.length, declaredIndexCount: models.reduce((sum, model) => sum + model.indexes.length, 0),
  models, permissionCatalog: permissions.PERMISSION_CATEGORIES, defaultRolePermissions: permissions.DEFAULT_ROLE_PERMISSIONS };
fs.writeFileSync(path.join(root, 'docs/DATABASE_SCHEMA.json'), JSON.stringify(result, null, 2) + '\n');

const escape = value => String(value).replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ');
const code = value => '`' + escape(value) + '`';
const defaultText = value => value.kind === 'value' ? JSON.stringify(value.value) + (value.implicit ? ' (implicit)' : '')
  : value.kind === 'generated' ? 'generated ObjectId' : value.kind === 'function' ? value.expression : value.explicit ? 'unset (explicit)' : 'unset';
const lines = [
  '# CRM database schema', '',
  'This reference describes the **current workspace code**, including the readiness changes. It was generated without loading `.env`, connecting to MongoDB, inspecting records, or reading credentials. Production may differ until deployment/index initialization. The database name comes from `MONGODB_URI`; its value is intentionally not read or included.', '',
  '**Database:** MongoDB. **ODM:** Mongoose. **Models/collections:** ' + models.length + '. **Declared indexes:** ' + result.declaredIndexCount + ', plus the normal `_id_` index on each ordinary collection. These are declarations, not verified live indexes.', '',
  '## Collection map', '', '| Collection | Mongoose model | Purpose |', '| --- | --- | --- |',
  ...models.map(m => `| ${code(m.collection)} | ${code(m.model)} | ${m.purpose} |`), '',
  '## Main relationships', '',
  'MongoDB ObjectId references are application-level links, not SQL foreign-key constraints. A `ref` enables Mongoose population; it does not prove a referenced record exists or provide cascading deletion. Several controllers separately validate assignment/activity access. The diagram shows the main logical relationships; detailed field tables below include every declared reference.', '',
  '```mermaid', 'erDiagram',
  '  Employee ||--o{ TaskTimeLog : records', '  Project ||--o{ TaskTimeLog : groups', '  Task ||--o{ TaskTimeLog : identifies',
  '  Client o|--o{ TaskTimeLog : attributes', '  Team o|--o{ Employee : primary_team', '  Employee o|--o{ Team : leads',
  '  Project }o--o{ Team : available_to', '  Project }o--o{ Client : linked_clients', '  Task }o--o{ Team : assigned_teams',
  '  Task }o--o{ Employee : assigned_people', '  Project ||--o{ ActivityMapping : maps', '  Client ||--o{ ActivityMapping : maps',
  '  Task ||--o{ ActivityMapping : maps', '  ActivityMapping o|--o{ TaskTimeLog : accepted_tuple',
  '  Employee ||--o{ Attendance : daily_presence', '  Employee ||--o{ AuthSession : authenticates',
  '  AuthSession ||--o{ DeviceLoginRequest : approval', '  TaskTimeLog ||--o{ TimeEntryEdit : correction_history',
  '  Employee ||--o| WorkingHoursPolicy : effective_requirements', '  Shift ||--o{ Schedule : template', '  Employee ||--o{ Schedule : assigned_day',
  '  Team ||--o{ Schedule : assigned_team', '  Project o|--o{ Task : primary_project',
  '```', '',
  '## How to read the field tables', '',
  '- `[]` means an array; `revisions[].requiredSeconds` describes each embedded array element.',
  '- Required applies when that path/subdocument is validated. A required array is not necessarily nonempty; a required child does not automatically make an optional parent mandatory.',
  '- `unset` means there is no schema default. It does not mean null. Defaults do not imply that older stored records were backfilled.',
  '- All root models enable timestamps: Mongoose manages `createdAt`/`updatedAt`. `_id` is normally generated; `__v` is the Mongoose version key, generally initially zero, not a universal optimistic concurrency lock.',
  '- `hidden` means excluded by ordinary Mongoose selection (`select: false`), including children of hidden embedded fields. It is not encryption or a database access-control boundary.',
  '- Empty primitive arrays normally default to `[]` unless explicitly suppressed. Embedded objects/arrays with `_id: false` do not get their own ObjectId; those with IDs have an `_id` row below.',
  '- Tables cover schema-level constraints. Controllers/services enforce additional permissions, relationships, concurrency and business rules described later. `unique` is an index declaration, not a Mongoose validator.', '',
];
for (const model of models) {
  lines.push(`## ${model.collection} (${model.model})`, '', model.purpose, '', `[Model source](../${model.source})`, '',
    '| Field | Type / reference | Required | Default | Constraints / selection |', '| --- | --- | --- | --- | --- |');
  for (const field of model.fields) {
    const rules = Object.entries(field.constraints).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    if (field.hiddenByDefault) rules.push('hidden');
    if (field.embeddedId !== undefined) rules.push(`embedded _id=${field.embeddedId}`);
    const custom = field.validators.filter(v => v.type === 'user defined');
    for (const v of custom) rules.push(`custom: ${v.message || v.expression}`);
    lines.push(`| ${code(field.path)} | ${escape(field.type)}${field.ref ? ` → ${code(field.ref)}` : ''} | ${field.required ? 'Yes' : 'No'} | ${code(defaultText(field.default))} | ${escape(rules.join('; ') || '—')} |`);
  }
  lines.push('', '**Declared indexes** (in addition to `_id_`):', '');
  if (!model.indexes.length) lines.push('No additional indexes declared.');
  else for (const index of model.indexes) lines.push(`- ${code(JSON.stringify(index.keys))}; options ${code(JSON.stringify(index.options))}`);
  lines.push('');
}
lines.push(
  '## Polymorphic and snapshot fields', '',
  '- `ClientAccessPolicy.subjectId` is interpreted as a Team or Employee according to `subjectType`; it has no static Mongoose `ref`. `workTeams`/`workProjects` grant work access separately from primary reporting membership.',
  '- `ClientAccessChange.targets[]` snapshots IDs/names and before/after policy values. The `id` members of its client/team/project snapshot arrays are context-dependent, not independently enforced foreign keys. `team` is a context ID without a declared `ref`.',
  '- `ActivityLinkChange.projects[]`, `clients[]` and `tasks[]` contain embedded `{ id, name }` audit snapshots; the IDs do not declare Mongoose `ref` constraints.',
  '- `TimeEntryEdit.before` and `after` are required `Mixed` values. The schema does not constrain their internal keys. The correction service snapshots employee/project/client/task/mapping IDs, interval timestamps, pauses, note, time totals, entry source and status; inspect `backend/src/services/timeEntryEditing.js` for the current snapshot field list.', '',
  '## Important application-level rules', '',
  '- Employee passwords are bcrypt-hashed in a pre-save hook. Changing password or email invalidates password-reset hashes in pre-validation. Hash fields are sensitive; this reference contains no values from real records. Query updates must still follow the controller/service rules.',
  '- Employee `serviceRates` and `projectRates` reject duplicate service/project assignments through custom validators. Service types are FTC, Tax, Bookkeeping, Audit and Business Tax Return. Current billing uses per-project rates and time logs; there is no dedicated invoice/billing collection among these models.',
  '- Employee roles are alpha/admin/manager/hr/team_lead/employee. Admin-level authority is defined in the roles/permissions services. Saved role-permission documents cover only hr/team_lead/employee; missing documents use built-in defaults.',
  '- Primary `Employee.team`/`teamLead` membership is synchronized by `teamAssignmentService`. Additional access-policy work teams/projects do not automatically grant management/report access.',
  '- Project `client` and Task `team` retain primary legacy references alongside `clients[]`/`teams[]`. Project `linkedTasks[]` and `activity_mappings` allow reuse without moving historical task IDs. Project `activityMappingEnabled` controls strict tuple selection.',
  '- Tasks/projects use `deletedAt` and status/active flags. Historical logs/mappings are retained; relationships can legitimately involve archived records.',
  '- Every new live timer receives a server-generated heartbeat. Heartbeats are sent about every 20 seconds; the lease expires after 90 seconds, with a 30-second sweep. Null heartbeat remains valid in the schema for manual/historical records; it is not an opt-out for new API starts.',
  '- Only one active timer per employee is enforced by a partial unique index. Start/manual operation indexes provide request identity. Manual entry/correction/live interval coordination additionally depends on the single-process per-employee write queue; indexes alone do not exclude overlapping stopped intervals.',
  '- `TaskTimeLog.totalWorkedSeconds`, paused/idle totals and pause intervals are computed/validated by the timer/manual/correction services. Manual entries require an explanatory reason, authorization and non-overlap checks; not all of these requirements appear as schema validators.',
  '- Attendance belongs to the business day on which the entry started. Its hours represent the first check-in to last checkout span, not net worked seconds. Legacy direct check-in/out writes are retired with HTTP 410; historical `source="check_in"` rows remain readable.',
  '- `Schedule.scheduleDateKey` is derived in pre-validation from its Date using `APP_TIMEZONE` (fallback Asia/Kolkata). The active-only partial unique index prevents two active schedules per employee/business-day key.',
  '- Working-hours requirements are versioned effective-date revisions; seconds range 0–86400, half-day percentage 1–100. Controller validation is stricter than the raw date-key strings in the model.',
  '- SystemSettings is a singleton keyed `global`. Global idle-policy normalization/validation uses a five-minute idle fallback and fifty-minute logout fallback; logout must exceed idle. `autoLogoutMinutes` has no schema default even though the runtime fallback exists. Per-employee nullable overrides fall back to the global policy.',
  '- AuthSession expiry and DeviceLoginRequest cleanup have TTL indexes. TTL cleanup is asynchronous; application expiry/status checks remain necessary. Device approval sessions/requests retain their own lifecycle status enums.',
  '- Optimistic versions are separate fields: project `activityLinksVersion`, client-access/working-hours `version`, time-log `editVersion`, and employee `timeEntryEditVersion`. Do not substitute `__v` for these business protocols.', '',
  '## Permission catalog', '',
  'The full catalog and built-in role permission lists are included in `DATABASE_SCHEMA.json`. The string-array fields do not all have schema enums: permission services validate configurable keys when saving.', '',
  '| Key | Label | Enforcement |', '| --- | --- | --- |',
  ...permissions.PERMISSION_CATEGORIES.flatMap(c => c.permissions.map(p => `| ${code(p.key)} | ${escape(p.label)} | ${escape(p.enforcement)} |`)), '',
  '## Index initialization and database-level limits', '',
  'The application explicitly initializes session, activity-mapping/link-history, correction-audit, manual-operation, working-hours and client-access indexes during startup. Other schema indexes depend on the configured Mongoose/model initialization. The revision plugin adds an `updatedAt` index to selected catalog models; it is included above. Auto-create/index options are included in the JSON export.', '',
  'Schema declarations are application validation, not a universal MongoDB JSON Schema validator. Raw collection writes can bypass Mongoose middleware/validators. This export does not establish the actual live index set, server validators, collection counts, orphan records, database/cluster name or backup status. Use an explicitly authorized read-only database inspection to compare a deployed environment.', '',
  '## Regenerate', '',
  'From the repository root:', '', '```powershell', 'node docs/schema/export-schema.cjs', '```', '',
  'This regenerates `docs/DATABASE_SCHEMA.md` and `docs/DATABASE_SCHEMA.json` from the checked-out models. It requires the installed backend dependencies and does not connect to a database. The JSON includes every extracted field, nested field, declared index, validator message/custom validator expression, permission definition and schema option.', '',
);
fs.writeFileSync(path.join(root, 'docs/DATABASE_SCHEMA.md'), lines.join('\n'));
console.log(JSON.stringify({ models: result.modelCount, fieldsIncludingEmbedded: models.reduce((n, m) => n + m.fields.length, 0), declaredIndexes: result.declaredIndexCount,
  outputs: ['docs/DATABASE_SCHEMA.md', 'docs/DATABASE_SCHEMA.json'], connected: mongoose.connection.readyState !== 0 }));
