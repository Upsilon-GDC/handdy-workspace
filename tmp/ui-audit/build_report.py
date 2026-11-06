from pathlib import Path
import base64, html, json

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
ICONS = json.loads((ROOT/'tmp/ui-audit/icons.json').read_text())
sources = {
 'R1': ('Handdy reports', 'https://www.handdy.com/help-text/category/reports/'),
 'R2': ('Clockify dashboard', 'https://clockify.me/help/reports/dashboard'),
 'R3': ('Clockify reports', 'https://clockify.me/help/getting-started/understand-use-your-reports'),
 'R4': ('Hubstaff dashboard', 'https://support.hubstaff.com/dashboard-widgets/'),
 'R5': ('ClickUp cards', 'https://help.clickup.com/hc/en-us/articles/25757497269143-Intro-to-cards'),
 'R6': ('WCAG text contrast', 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html'),
 'R7': ('WCAG target size', 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html'),
 'R8': ('WCAG visible focus', 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html'),
}
def ref(key): return f'<a class="ref" href="{sources[key][1]}">[{key}]</a>'
def p(text, cls=''): return f'<p class="{cls}">{text}</p>'
def h(text): return f'<h3>{text}</h3>'
def bullets(items): return '<ul>'+''.join(f'<li>{x}</li>' for x in items)+'</ul>'
def table(headers, rows, widths=None):
    cols = '<colgroup>'+''.join(f'<col style="width:{w}%">' for w in widths)+'</colgroup>' if widths else ''
    return '<table>'+cols+'<thead><tr>'+''.join(f'<th>{x}</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join(f'<td>{x}</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table>'
def image(path, caption, height=255):
    data=base64.b64encode((ROOT/path).read_bytes()).decode()
    return f'<figure><img src="data:image/png;base64,{data}" style="max-height:{height}px"><figcaption>{caption}</figcaption></figure>'
def icon(name): return ICONS[name]
pages=[]
def page(section, title, content):
    n=len(pages)+1
    pages.append(f'<section class="page"><div class="running">CRM WORKSPACE <span>UI REVIEW · 4 NOVEMBER 2026</span></div><div class="eyebrow">{section}</div><h1>{title}</h1>{content}<footer><span>UI audit and comparison report · Local build review</span><b>{n:02d}</b></footer></section>')

page('01 / Decision summary', 'Make the interface consistent before adding more decoration',
 p('Your CRM already supports the main time-tracking and administration workflows. The next UI update should make those workflows easier to scan and act on: consistent headings, predictable cards, clear action priority and less space between a user and the control they need.')+
 p('<b>Recommended direction:</b> retain the green workspace identity and existing permissions, calculations and timer rules. Build a shared component standard, then apply it to the most frequently used screens. This is a UI report, not an instruction to replace the app or its backend.')+
 table(['First priorities','Why they matter'],[
 ('One header and toolbar pattern','Tasks currently repeats its page heading; other modules use different title treatments.'),
 ('One card family with clear purposes','Metric, navigation, team selection and editing cards need different, predictable behavior.'),
 ('Readable, quieter controls','Secondary text is often small, and too many toolbar actions compete with Save or Create.'),
 ('Shorter paths to useful content','Repeated context bars, tall headers and stacked filters reduce the number of visible rows.'),
 ('Consistent mobile and keyboard behavior','Pinned controls, horizontal tables and floating theme controls need careful focus and overlap checks.'),
 ],[32,68])+
 image('backend/.local-repairs/working-hours-review/settings-team-cards.png','Existing improvement to keep: choose a team before loading its employees. Current fixture capture, 4 November 2026; blue Console theme.',225)+
 p('<b>Evidence:</b> current source, fresh synthetic-data captures of six administration modules and two forms, and existing 4 November QA captures for hours, links, reports and desktop states. No production employee records were used. This is an expert review, not a measured usability study or a WCAG certification.','small'))

page('02 / Scope and current condition', 'Coverage of the whole application',
 p('Visual review and source review are distinguished below. Screenshots confirm only their captured state. The latest team-first hours flow is included.')+
 table(['Area','Evidence reviewed','Main UI decision'],[
 ('Shared shell and navigation','Fresh web captures + AppShell and navigation source','Preserve role-aware groups; simplify page chrome and improve disclosure cues.'),
 ('Overview and productivity','4 November QA captures + overview components','Separate live status, period totals and daily targets visibly.'),
 ('Clients','Fresh current-build capture + source','Use the same list toolbar and row-action pattern as Projects.'),
 ('Projects and create form','Fresh capture + form capture + source','Keep project details concise; show relationships in the linking workflow.'),
 ('Tasks and task creation','Fresh list capture + source + project selection QA','Remove duplicate heading; standardize assignment and bulk controls.'),
 ('Teams','Fresh capture + source','Use consistent member counts and drilldown affordances.'),
 ('Employees and create form','Fresh desktop, mobile and modal captures','Fix search inset; prioritize columns and shorten the form visually.'),
 ('Working hours','Current team cards, selected team and mobile QA + source','Retain team-first selection and whole-team / individual choice.'),
 ('Task links and client links','4 November QA captures + shared editor source','Keep distinct modes, selected counts, review and saved history.'),
 ('Add Entry and Edit Entries','4 November QA + source','Retain team/employee scoping and review before save.'),
 ('Timesheets and attendance','Report source + 4 November report QA','Unify filters, duration formats and export placement.'),
 ('Billing','Billing page source; older visuals not used as current evidence','Keep money separate from hours; verify long names and missing rates.'),
 ('Idle settings and permissions','Fresh idle capture; permission source review','Match UI wording to actual stop/logout rules; make scope explicit.'),
 ('Desktop timer and warnings','4 November startup/idle/break QA + renderer source','Communicate real timer state and manual Start clearly.'),
 ('Login, profile and help','Current components/source; older visual references only','Apply shared fields, feedback and heading standards.'),
 ('Shifts and scheduling','Source only; not exposed by the reviewed main navigation','Inventory only. Do not redesign or promote these routes without confirming product scope.'),
 ],[24,35,41])+
 p('<b>Keep:</b> role-based menus, explicit time-entry reviews, accessible text beside status colors, saved linking history, separate break/idle values and manual timer start. These are useful foundations, not redesign defects.','small'))

page('03 / Layout and navigation', 'Give more of the screen to the work',
 image('tmp/ui-audit/screens/tasks.png','Fresh current build, green Upsilon theme, synthetic tasks. The duplicated Tasks heading is visible above the toolbar.',290)+
 table(['Finding','Recommendation','Priority'],[
 ('F01 · Duplicate and inconsistent titles','Render one page title. Use one compact title / description / primary-action row across lists and settings.','P1'),
 ('F02 · Repeated vertical context','Keep breadcrumb and title. Make the generic date/context line and footer less prominent on dense work screens.','P1'),
 ('F03 · Group expansion is not visually explicit','Add a chevron and clear expanded state to sidebar group headings. Keep the current group open and preserve keyboard activation.','P2'),
 ('F04 · Different type identities','Choose one application heading family. Current shared pages use Georgia while newer hours settings use sans-serif.','P1'),
 ],[29,60,11])+
 h('Recommended page structure')+p('<b>Breadcrumb → compact page header → filters → results → context-specific footer.</b> Keep Save with the editor and Create with the list header. Do not add an introductory launch card before an editor that the navigation already opens directly.')+
 p('The existing collapsible sidebar and route search are useful. Avoid replacing them with extra decorative navigation cards on every page. Use team cards where selecting a team is the actual first step, as in Working Hours.'))

page('04 / Card design', 'Use a small family of cards with clear behavior',
 p('Cards should communicate a purpose, not merely add white boxes. Keep a consistent radius, border, title style and spacing, then vary the internal layout according to what the card does.')+
 table(['Card type','Required content','Interaction'],[
 ('Metric','Label, value, unit, time scope, optional comparison','Read-only unless a specific drilldown is provided; label that drilldown.'),
 ('Team selection','Team icon, name, member count, configuration count','Entire card opens the team; show hover, focus and selected state.'),
 ('Employee selection','Name, employee ID, team, relevant status','Clear checkbox or selection control; separate individual Edit action.'),
 ('Progress','Completed / required, percentage, pending, overtime','Caption explains the denominator; use a real progress value.'),
 ('Editor','Section title, scope summary, fields, feedback, Save','Keep the primary action visible and protect unsaved changes.'),
 ('Report / list container','Title, result count, filters or table','Use rows for comparison; avoid putting every table cell into a card.'),
 ],[20,43,37])+
 h('Proposed visual examples')+
 '<div class="prototype-label">PROPOSED COMPONENT STANDARD · Illustrative values, not application data</div><div class="prototype-grid"><div class="demo-card"><div class="demo-row">'+icon('Users')+'<b>WCPA</b>'+icon('ArrowRight')+'</div><p>11 employees · 9 configured</p><small>Open employees</small></div><div class="demo-card"><small>Required hours today</small><div class="demo-number">40h <span>of 5 present employees</span></div><div class="demo-bar"><i></i></div><p>27h completed · 13h pending</p></div></div>'+
 bullets(['Use 16-20 px internal padding, 12 px corners and a subtle 1 px border as the proposed baseline. These are design targets, not current measured values.','Reserve elevation for menus, dialogs and pinned controls. A shadow on every nested panel adds noise.','Use the same selected treatment everywhere: accent border plus a check or text state. Hover alone must not look selected.','Avoid whole-card buttons containing nested action buttons. A team card can open details; employee Edit and checkbox controls need distinct targets.'])+
 p('<b>F05 · Progress meaning:</b> the existing activity card bar scales hours against the busiest team; the new productivity bar measures requirement completion. Similar bars imply the same meaning. Label or restyle them so a relative-hours bar cannot be read as a percentage target.','small'))

page('05 / Icons and visual tokens', 'Standardize icons typography and color',
 p('Lucide is already used by the web shell and several modules. Keep that family; a larger icon collection is not the main need. Make meaning, weight and placement consistent. The mapping below is a proposed design vocabulary.')+
 table(['Icon','Meaning','Icon','Meaning'],[
 (icon('LayoutDashboard'),'Overview',icon('Users'),'Teams and people'),
 (icon('Building2'),'Clients',icon('FolderKanban'),'Projects'),
 (icon('ListChecks'),'Tasks',icon('Link2'),'Relationships and links'),
 (icon('Clock3'),'Tracked time',icon('ClipboardPlus'),'Add manual entry'),
 (icon('Pencil'),'Edit',icon('ReceiptText'),'Billing'),
 (icon('CalendarDays'),'Date and attendance',icon('Settings2'),'Settings'),
 (icon('Search'),'Search',icon('ChevronDown'),'Expand / collapse'),
 (icon('Coffee'),'Break',icon('CircleAlert'),'Warning or attention'),
 (icon('Trash2'),'Delete',icon('Download'),'Export or download'),
 ],[10,40,10,40])+
 '<div class="cols"><div>'+h('Proposed type and spacing scale')+bullets(['Body 14 px; supporting labels 12 px; page title 24-28 px; card title 16 px; KPI 28-32 px.','Use tabular numerals for clocks, hours, rates and totals. Keep seconds when editing or reconciling time.','Use 4 / 8 / 12 / 16 / 24 / 32 px spacing tokens instead of one-off margins.'])+'</div><div>'+h('Proposed icon and color rules')+bullets(['16 px inside controls, 20 px in cards, consistent stroke weight around 1.75-2.','Brand green for primary actions; neutral for secondary; red for destructive confirmation; amber for warnings.','Use text labels with unfamiliar icons. Give icon-only controls accessible names and adequate hit areas.'])+'</div></div>'+
 p('<b>F06 · Small labels:</b> shared styles include 10-11 px supporting text. Do not assume that every small label fails accessibility; prioritize frequently read names, scope notes and form help for enlargement.')+
 p('<b>F07 · Theme governance:</b> nine theme definitions exist and the default is Console blue. Saved Upsilon green is preserved. Choose a primary review theme and test one alternate; maintain identical geometry and semantic status meaning across palettes. The desktop installer also uses the default Electron icon: add a branded app icon as a separate asset task.','small'))

page('06 / Forms and actions', 'Make editing clearer without changing business rules',
 image('tmp/ui-audit/screens/employees-modal.png','Fresh employee form. The action footer stays reachable, but required asterisks fall onto separate lines in this captured layout.',280)+
 table(['Finding','Proposed change'],[
 ('F08 · Required markers create extra lines','Keep the label and required indicator inline. Group related fields; make optional sections visibly optional.'),
 ('F09 · Unequal form treatment','Use a shared Field, Select, MultiSelect and FormSection standard with consistent spacing, help, validation and disabled states.'),
 ('F10 · Too many actions use primary styling','One dominant action per active editor. Search, Refresh, Clear and Back should normally be neutral; reserve brand fill for Save / Create / Start.'),
 ('F11 · Long forms need progressive disclosure','Keep account identity first; expand rates or other optional sections only when needed. Preserve the currently useful sticky action footer.'),
 ],[32,68])+
 h('Relationships and destructive changes')+p('Keep one project selection section for task creation/editing and preserve multiple-project support. In linking and entry corrections, show exactly which teams, projects, clients and employees will change before confirmation. Use explicit button labels such as Confirm unlink; display success only after the server confirms it.')+
 p('Move from class-name-based button styling toward explicit Primary, Secondary, Tertiary and Destructive variants. The shared stylesheet currently changes appearance by matching words in CSS class names, which makes a new button’s appearance harder to predict.','small'))

page('07 / Tables and reports', 'Improve scanning before adding more charts',
 image('tmp/ui-audit/screens/employees.png','Fresh employee directory with 125 synthetic records in the fixture. The search icon overlaps the placeholder, and some row actions extend into the horizontal scroll region.',260)+
 table(['Finding','Proposed change','Priority'],[
 ('F12 · Search inset collision','Place the icon in a fixed slot; reserve padding before text in every size. Recheck focus and typed text.','P1'),
 ('F13 · Wide tables hide useful actions','Prioritize employee/task name, status and the main action. Put lower-frequency fields in details or a column chooser.','P1'),
 ('F14 · Table controls vary by module','Standardize search placement, filter labels, page size, sort indicators and pagination. Keep the result count near the table.','P2'),
 ('F15 · Duration formats vary by purpose','Use concise hours/minutes in summaries; show seconds in detailed records, corrections and audit evidence. Label timezone and date scope.','P1'),
 ('F16 · Overloaded report landing views','Start with the relevant team/employee scope. Keep grouping and exports near the report, not in a separate decorative card.','P2'),
 ],[29,60,11])+
 p('<b>Recommended table anatomy:</b> title and count → compact filters → column headings → records → pagination. Pin identity or actions only when needed. Keep one clear horizontal scroll region; a page that fits the viewport can still contain an intentionally scrollable table.')+
 p('For mobile, show the person or task, status and main action first; expand contact, rates and secondary fields on demand. The current employee mobile view stacks each field into a tall section, so one record can consume most of a screen. This is responsive, but not yet efficient for reviewing a team.','small'))

page('08 / Hours and linking workflows', 'Keep the recent improvements and make scope unmistakable',
 '<div class="cols images"><div>'+image('backend/.local-repairs/working-hours-review/settings-team-cards.png','Current hours settings: team-first navigation. Console theme.',185)+'</div><div>'+image('backend/.local-repairs/linking-empty-ui.png','Current linking editor: separate project/client selectors. Upsilon theme.',185)+'</div></div>'+
 h('Working hours')+bullets(['Keep the team cards, Whole team / Choose employees actions and individual Edit requirement flow. These improvements are already implemented.','F17 · Show the active team and selected employee count beside Save. When a search hides selected members, state that those members are still selected. Whole team should explicitly mean all members, not only visible rows.','F18 · Differentiate daily target, half-day percentage and approved date exception. Show a duration preview beside decimal input; preserve 7.8 hours = 7h 48m.','Keep pending and overtime separate. For unconfigured or zero-requirement staff, consider an em dash or Not configured / No requirement instead of an unexplained 0% progress bar.'])+
 h('Task links and project and client links')+bullets(['Keep the two independent routes and their distinct scopes. The client-only page must not require task selection.','F19 · Make the selection summary the review anchor: Projects × Clients × Tasks, selected names, and action. Keep link and unlink review wording distinct.','Keep successful-save reset and History below the editor. A history list is completed actions, not necessarily a complete inventory of current links; label that distinction.','A fixed-height picker is useful for long catalogs. On smaller laptops, reduce header padding before reducing row readability or hiding review actions.'])+
 p('<b>Business meaning to preserve:</b> productive tracked time is not task completion. Leave, half-day targets, client-specific task access and historical time must retain their existing rules throughout any visual update.','small'))

page('09 / Desktop and mobile', 'Make state and the next action easy to understand',
 '<div class="cols images"><div>'+image('dashboard/ui-review/idle-popup.png','4 November desktop QA capture; synthetic employee and simulated idle state.',220)+'</div><div>'+image('tmp/ui-audit/screens/employees-mobile.png','Fresh mobile employee directory. Large stacked field groups require substantial vertical review.',300)+'</div></div>'+
 table(['Area','Recommendation'],[
 ('F20 · Timer states','Keep Not started, Starting, Working, On break, Idle and connection-error states distinct. Use the server-confirmed timer; never show speculative elapsed work.'),
 ('F21 · Continue versus Start','The idle acknowledgement does not restart the timer. Consider Return to CRM or a short explicit note so Continue is not mistaken for Resume work.'),
 ('F22 · Settings copy versus real behavior','The captured idle settings page says Pause a running timer, while the current desktop idle flow stops work. Update wording to the actual policy rather than changing behavior to match old text.'),
 ('F23 · Desktop startup and lock','Keep CRM visible above the blank overlay, explain why the screen is covered, and unlock only after confirmed Start. Include a clear connection-recovery message.'),
 ('F24 · Mobile efficiency','Use compact identity rows, collapsible secondary details and reachable actions. Pinned controls must leave enough viewport for the record being selected.'),
 ],[27,73])+
 p('Keep native desktop controls distinct from browser administration. The timer screen should prioritize the chosen project/client/task, truthful status, elapsed time and Start/Stop. An administrative card dashboard is not a replacement for that focused timer workflow.'))

page('10 / Other applications', 'Compare interaction patterns rather than copy a whole product',
 p('The comparison uses official documentation accessed on 4 November 2026. These are documented patterns and design references, not hands-on paid-account audits, feature-parity claims or ratings of the entire products. Availability can vary by role and plan.')+
 table(['Reference','Documented pattern','What to adapt for CRM','What to verify yourself'],[
 ('Handdy '+ref('R1'),'Desktop time capture and website reports organized around clients, projects, tasks and teams.','Clear capture-versus-reporting roles, consistent scope filters and explicit work/break labels.','Try the current timer and report interface. Do not infer present visual quality from help text.'),
 ('Clockify '+ref('R2')+' '+ref('R3'),'Personal/team dashboard contexts; team activity table; summary, detailed and weekly reports.','Clear person/team context, task-oriented report modes and optional prominence for frequently used activity data.','Run the same report task in both apps; compare filter effort, row readability and drilldown.'),
 ('Hubstaff '+ref('R4'),'Dashboard widgets can be managed, moved or removed; personal and team contexts are separated.','Give managers a short, relevant overview and clearly scoped widgets. Start with a sensible fixed layout before adding customization.','Check which metrics employees actually need; do not add widgets only to fill space.'),
 ('ClickUp '+ref('R5'),'Cards organize Overview/Dashboard information; available card types and limits vary.','Create consistent card anatomy and role-appropriate modules rather than different card styles for every new feature.','Check whether cards speed the real workflow. Dense records may still work better in a list.'),
 ],[15,28,34,23])+
 h('Recommended reference mix')+p('<b>Clockify:</b> report organization. <b>Hubstaff:</b> overview relevance. <b>ClickUp:</b> reusable card concepts. <b>Handdy:</b> the desktop-to-web workflow that your employees already recognize. Your existing green brand, team access rules and Upsilon defaults can remain your own.')+
 p('Do not treat screenshots from different screen sizes or themes as a fair comparison. Match the viewport, role, date range, sample size and task first. Use the worksheet on page 13 to collect comparable evidence.','small'))

page('11 / Accessibility and feedback', 'Validate readability and recovery in every state',
 p('This review identifies risks and proposes checks; it does not establish WCAG conformance. Small text, a cropped screenshot or an icon alone is not sufficient evidence of a formal failure.')+
 table(['Check','Acceptance target for the update'],[
 ('Text contrast '+ref('R6'),'Measure actual foreground/background pairs. WCAG AA requires 4.5:1 for ordinary text and 3:1 for qualifying large text. Check muted help text and every theme.'),
 ('Pointer targets '+ref('R7'),'WCAG 2.2 AA target-size criterion is 24 × 24 CSS px, with defined exceptions including spacing. Use 40-44 px as a practical product target for frequent touch controls; that larger target is a recommendation.'),
 ('Visible keyboard focus '+ref('R8'),'Tab through menus, filters, rows, drawers and pinned controls. Focus must not be entirely hidden by author-created content. Prefer fully visible focus.'),
 ('Icons and labels','Give icon-only controls accessible names. Use adjacent text for status; do not rely on green/red alone. Keep decorative icons out of the accessibility tree.'),
 ('Dialogs','Keep the existing ModalFrame focus trap, Escape handling and focus return. Verify long forms and custom dropdowns inside each dialog, not only the shell.'),
 ('Motion and refresh','Respect reduced-motion preferences. Background refresh should not steal focus, reset selections or erase unsaved notes.'),
 ],[28,72])+
 h('Feedback states to standardize')+table(['State','Expected treatment'],[
 ('Initial loading','Short status or skeleton with a stable layout; do not present a meaningful zero before data arrives.'),
 ('Empty results','Distinguish no records, no matches and no access. Offer the relevant next step.'),
 ('Saving','Disable duplicate submission, state which action is pending, and preserve context.'),
 ('Success','Confirm the saved scope. Reset fields only where the existing workflow requires it.'),
 ('Validation or stale update','Keep selections, explain what must change, and offer reload/retry without claiming the save succeeded.'),
 ('Network failure','Show the last successful result when available and label it as stale. Keep a clear retry action.'),
 ],[24,76])+
 p('<b>F25 · Floating theme control:</b> screenshots show it occupying the bottom-right region near row actions and panel footers. Move it into an account/settings menu, or reserve space so it cannot obscure an actionable control.','small'))

page('12 / Update priorities', 'A practical backlog for a controlled UI refresh',
 p('Priority reflects likely frequency and user impact, not a measured defect count. Effort is relative: S = isolated component or copy, M = several related screens, L = shared structure with broader regression testing. No delivery dates are implied.')+
 table(['Priority','Work item','Evidence','Effort'],[
 ('P1','Remove duplicate Tasks heading; adopt one compact page header.','F01, F02, F04','S-M'),
 ('P1','Fix employee search icon/text inset at desktop and mobile sizes.','F12','S'),
 ('P1','Correct idle stop/pause and acknowledgement wording.','F21, F22','S'),
 ('P1','Make primary/secondary/destructive button variants explicit.','F10, F16','M'),
 ('P1','Label every progress bar with its actual denominator.','F05, F18','S-M'),
 ('P1','Move the theme trigger or prevent overlap with actions.','F25','S-M'),
 ('P2','Standardize cards, selected states, icons and typography.','F04, F06, F07, F09','M'),
 ('P2','Unify list filters, pagination, column priorities and row actions.','F13, F14, F15','M-L'),
 ('P2','Compact employee mobile rows and long administrative forms.','F08, F11, F24','M'),
 ('P2','Make hidden selections and bulk-save scope explicit.','F17, F19','S-M'),
 ('P2','Add sidebar disclosure cues and verify focus behavior.','F03','S-M'),
 ('P3','Add branded desktop/app icons; consider optional dashboard layout preferences only after usability testing.','F07 and comparison review','M'),
 ],[11,59,17,13])+
 h('Recommended implementation order')+p('<b>First:</b> header, search, copy and action hierarchy. <b>Next:</b> shared components applied to Employees, Tasks, Working Hours and Links. <b>Then:</b> reports, billing, mobile detail patterns and any optional dashboard customization.')+
 p('Use visual snapshots plus workflow tests at each step. Keep timer start/stop, startup lock, entry correction, task reuse, permissions, client-specific linking and hour calculations unchanged unless a separate behavior change is requested.')+
 h('Done means')+bullets(['One Tasks title; no icon/text overlap; one obvious primary action in the active editing context.','The last member of a long roster can be selected and saved without searching for the Save button.','Role restrictions, date scopes, half-day rules, history and timer confirmation survive the refresh.']))

page('13 / Comparison worksheet', 'Use the same tasks in each application',
 p('Complete this worksheet with current screenshots or recordings from accounts you are authorized to use. The CRM column is your baseline to measure; blank competitor cells mean not evaluated. Do not fill them with assumptions from marketing pages.')+
 table(['Task','CRM baseline to record','Handdy','Clockify','Hubstaff'],[
 ('Start a normal work timer','Time to choose project/client/task; clicks; whether Starting and Running are distinct.','Not tested','Not tested','Not tested'),
 ('Find one employee’s daily hours','Clicks, filters, date certainty, readability and time to a correct answer.','Not tested','Not tested','Not tested'),
 ('Compare two teams','Time to understand worked vs required vs pending; ability to explain progress bars.','Not tested','Not tested','Not tested'),
 ('Change a group requirement','Time to select team or people; scope clarity; confirmation; recovery from an error.','Not tested','Not tested','Not tested'),
 ('Correct a time entry','Employee selection, audit visibility, editable precision and review clarity.','Not tested','Not tested','Not tested'),
 ('Use a 390 px wide screen','Main action reachability, table/detail readability, horizontal scroll and keyboard focus.','Not tested','Not tested','Not tested'),
 ],[22,36,14,14,14])+
 h('Record these observations')+bullets(['Record screen size, zoom, role, theme, record count and date range.','Measure seconds, clicks, wrong turns, assistance and result correctness.','Ask the user to explain the next action, selected scope and main number. Check recovery after errors.','For ClickUp, compare card organization and list density rather than assuming an equivalent desktop time-lock workflow.'])+
 h('Simple rating rubric for your own comparison')+table(['Rating','Meaning'],[
 ('1','User cannot complete the task without assistance.'),('2','Task completes with major confusion or repeated wrong turns.'),('3','Task completes with minor friction.'),('4','Task is clear, efficient and recoverable after errors.'),('5','Task is immediately understandable and remains efficient across roles and screen sizes.'),
 ],[13,87])+
 p('These are proposed research measures, not scores awarded to any application in this report. Keep task results separate from visual preference: an attractive screen can still be slower to use.','small'))

page('14 / Evidence and references', 'Traceable sources and review limitations',
 p('<b>Review date:</b> 4 November 2026, Asia/Calcutta. <b>Prepared for:</b> the CRM workspace owner and the team planning its next UI update. <b>Method:</b> source inspection, current-build fixture captures, existing same-day QA captures and official documentation research.')+
 h('Local implementation evidence')+
 table(['Source area','What it supports'],[
 ('dashboard/src/components/layout/','Role-aware sidebar, route search, generic context line, PageHeader and modal focus behavior.'),
 ('dashboard/src/styles/workspace.css','Shared typography, 10-11 px supporting text, broad button styling and later serif heading overrides.'),
 ('dashboard/src/context/ThemeContext.jsx and themeContextInstance.js','Console default, preserved saved theme and nine named palettes.'),
 ('AdminTasks, AdminEmployees, AdminProjects and related pages','Current list structures, filters, duplication, create/edit forms and assignment controls.'),
 ('WorkingHoursSettings, TeamWorkingHours and AdminOverviewPage','Team cards, selection scope, daily progress, period/live distinctions and relative-hours bar.'),
 ('BatchActivityLinksForm and ActivityLinksHistory','Link combinations, review, reset and completed-change history.'),
 ('desktop-app/renderer.js and timer-lock.js','Confirmed timer state, idle acknowledgement, startup defaults and screen-lock behavior.'),
 ],[48,52])+
 h('Official references')+
 ''.join(p(f'<b>{key}</b> · <a href="{url}">{name}</a><br><span class="url">{url}</span>','source') for key,(name,url) in sources.items())+
 p('<b>Limitations:</b> no production analytics, interviews, formal accessibility measurements, complete keyboard audit, paid competitor accounts or exhaustive cross-browser testing. Fixture numbers, names and counts illustrate layouts only. Scheduling, billing, permissions, profile and help recommendations include source-level review where fresh representative visuals were not captured. Historical screenshots dated 23 October were not treated as proof of the current layout.','small'))

css='''
@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#e8ecea;color:#172b25;font-family:"Segoe UI",Arial,sans-serif;font-size:14px;line-height:1.5}.page{position:relative;width:210mm;height:297mm;padding:14mm 15mm 17mm;background:white;margin:10px auto;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.running{font-size:10px;font-weight:700;letter-spacing:1px;color:#376452;border-bottom:1px solid #dce5df;padding-bottom:8px;margin-bottom:18px}.running span{float:right;color:#63736c;font-weight:400}.eyebrow{font-size:10px;font-weight:700;text-transform:uppercase;color:#507161;letter-spacing:1.1px;margin-bottom:7px}h1{font-size:27px;line-height:1.15;letter-spacing:-.5px;margin:0 0 15px;color:#11271f}h3{font-size:15px;margin:15px 0 6px;color:#16392b}p{margin:8px 0 11px}b,strong{font-weight:650}.small{font-size:11.5px;line-height:1.45;color:#52655a}.source{font-size:11.5px;line-height:1.3;margin:7px 0}.url{font-size:10px;color:#53665d;overflow-wrap:anywhere}a{color:#1e644e;text-decoration:underline}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:12px 0 15px;font-size:12px;line-height:1.45}th,td{border:1px solid #d9e2dc;padding:9px 10px;text-align:left;vertical-align:top;overflow-wrap:break-word}th{background:#1e4938;color:white;font-weight:600;font-size:11px}tr:nth-child(even) td{background:#f4f7f5}td svg{vertical-align:middle;color:#1e644e}figure{margin:13px 0 12px;text-align:center}figure img{width:auto;max-width:100%;object-fit:contain;border:1px solid #dce5df}figcaption{font-size:10.5px;line-height:1.35;color:#5d6f64;text-align:left;margin-top:5px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}.cols h3{margin-top:8px}.images figure{margin-top:4px}ul{padding-left:18px;margin:6px 0 10px}li{padding-left:1px;margin:7px 0}.ref{font-size:10px;white-space:nowrap}footer{position:absolute;left:15mm;right:15mm;bottom:10mm;display:flex;justify-content:space-between;border-top:1px solid #dae4dd;padding-top:6px;color:#6a7b70;font-size:9px}.prototype-label{font-size:10px;letter-spacing:.5px;color:#66776c;margin:12px 0 7px}.prototype-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.demo-card{padding:18px;border:1px solid #dce4df;border-radius:12px}.demo-row{display:flex;gap:10px;align-items:center}.demo-row b{flex:1}.demo-card small,.demo-card p{color:#617369;font-size:12px}.demo-number{font-size:29px;font-weight:650;margin-top:8px}.demo-number span{font-size:11px;color:#617369;display:block;font-weight:400}.demo-bar{height:7px;border-radius:8px;background:#e7eee9;margin:11px 0}.demo-bar i{display:block;height:7px;width:67.5%;background:#1e644e;border-radius:8px}@media print{body{background:white}.page{margin:0}}
'''
css += '.page:nth-child(2) td{padding-top:5.5px;padding-bottom:5.5px}.page:nth-child(2) table{font-size:11.8px}.page:nth-child(4) li{margin-top:5px;margin-bottom:5px}.page:nth-child(4) td{padding-top:8px;padding-bottom:8px}.page:nth-child(13) td,.page:nth-child(14) td{padding-top:6px;padding-bottom:6px}'
(ROOT/'tmp/ui-audit/report.html').write_text('<!DOCTYPE html><html lang="en"><meta charset="utf-8"><title>CRM UI Audit and Comparison Report</title><style>'+css+'</style><body>'+''.join(pages)+'</body></html>',encoding='utf-8')
print(f'Authored {len(pages)} report pages')
