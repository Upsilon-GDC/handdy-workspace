const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const message = document.getElementById("message");
const rememberedLogin = document.getElementById("rememberedLogin");
const rememberedAvatar = document.getElementById("rememberedAvatar");
const rememberedName = document.getElementById("rememberedName");
const rememberedEmail = document.getElementById("rememberedEmail");
const quickLoginButton = document.getElementById("quickLoginButton");
const differentAccountButton = document.getElementById("differentAccountButton");

const loginSection = document.getElementById("loginSection");
const appSection = document.getElementById("appSection");
const isLoginPage = document.body.dataset.page === "login";

const userName = document.getElementById("userName");
const userRole = document.getElementById("userRole");

const todayDate = document.getElementById("todayDate");
const todayTotal = document.getElementById("todayTotal");
const todayBreak = document.getElementById("todayBreak");
const timesheetBreakDuration = document.getElementById("timesheetBreakDuration");
const todayIdle = document.getElementById("todayIdle");
const todaySessions = document.getElementById("todaySessions");
const todayTasks = document.getElementById("todayTasks");
const todayTimesheetBody = document.getElementById("todayTimesheetBody");
const todayTimesheetEmpty = document.getElementById("todayTimesheetEmpty");
const timesheetMessage = document.getElementById("timesheetMessage");
const refreshTimesheetButton = document.getElementById(
  "refreshTimesheetButton"
);

const projectSelect = document.getElementById("projectSelect");
const taskSelect = document.getElementById("taskSelect");
const workSelectionMessage = document.getElementById(
  "workSelectionMessage"
);
const profileFullName = document.getElementById("profileFullName");
const profileEmployeeId = document.getElementById("profileEmployeeId");
const profileRole = document.getElementById("profileRole");
const profileDepartment = document.getElementById("profileDepartment");
const profileDesignation = document.getElementById("profileDesignation");
const profileEmail = document.getElementById("profileEmail");
const profileStatus = document.getElementById("profileStatus");
const timerStatus = document.getElementById("timerStatus");
const timerDuration = document.getElementById("timerDuration");
const timerMessage = document.getElementById("timerMessage");

const startTimerButton = document.getElementById(
  "startTimerButton"
);

// Manual breaks are recorded by starting a break-type task. Pausing remains
// available internally for idle tracking and older in-progress sessions.
const pauseTimerButton = null;
const resumeTimerButton = null;
const breakClock = document.getElementById("breakClock");
const breakDuration = document.getElementById("breakDuration");
const stopBreakButton = document.getElementById("stopBreakButton");

const stopTimerButton = document.getElementById(
  "stopTimerButton"
);

const logoutButton = document.getElementById("logoutButton");
const timerNavigationButtons = document.querySelectorAll("[data-timer-view]");
const timerViewPanels = document.querySelectorAll("[data-timer-panel]");
const accountMenuButton = document.getElementById("accountMenuButton");
const accountMenu = document.getElementById("accountMenu");
const clientSelect = document.getElementById("clientSelect");
const currentDate = document.getElementById("currentDate");
const addNoteButton = document.getElementById("addNoteButton");
const timerNote = document.getElementById("timerNote");
const noteActions = document.getElementById("noteActions");
const saveNoteButton = document.getElementById("saveNoteButton");
const noteSaveStatus = document.getElementById("noteSaveStatus");
const deviceLoginModal = document.getElementById("deviceLoginModal");
const requestingDeviceName = document.getElementById("requestingDeviceName");
const deviceLoginMessage = document.getElementById("deviceLoginMessage");
const keepThisDeviceButton = document.getElementById("keepThisDeviceButton");
const allowNewDeviceButton = document.getElementById("allowNewDeviceButton");
const idleStartedDialog = document.getElementById("idleStartedDialog");
const idleStartedDuration = document.getElementById("idleStartedDuration");
const idleLogoutCountdown = document.getElementById("idleLogoutCountdown");
const idleStartedTime = document.getElementById("idleStartedTime");
const acknowledgeIdleButton = document.getElementById("acknowledgeIdleButton");
const timerLockNotice = document.getElementById("timerLockNotice");

const API_BASE_URL =
  window.electronAPI?.apiBaseUrl || "http://localhost:5000/api";
const DEVICE_INFO = window.electronAPI?.deviceInfo || {
  deviceId: "desktop-development-device",
  deviceName: "CRM desktop app",
  clientType: "desktop",
};
let timerInterval = null;
let idleMonitorInterval = null;
let timerHeartbeatInterval = null;
let idlePolicyRefreshInterval = null;
let dataRefreshInterval = null;
let idleCheckInProgress = false;
let lastIdleNoticeKey = null;
let idleNoticeInterval = null;
let idleNoticeSnapshot = null;
let idleAcknowledgedAt = null;
let pendingIdleStop = null;
let idlePolicy = null;
let currentTimeLog = null;
let automaticIdlePause = false;
let idleDefaults = null;
let logoutPending = false;
let logoutInProgress = false;
let appClosePending = false;
let timerAction = null;
// IDs for one start or stop action. A retry after a lost or failed response
// reuses the ID, so the server returns the first result instead of acting
// twice (backend taskTimeLogController). Cleared once the server has decided.
let pendingStartOperation = null;
let pendingStopOperation = null;
const newOperationId = () => globalThis.crypto?.randomUUID?.()
  || `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
let activeTaskIdleLogout = false;
let loginInProgress = false;
let deviceApprovalMonitorActive = false;
let pendingDeviceLoginRequest = null;
let noteDirty = false;
let todayTimesheetLogs = [];
const reportSnapshots = new Map();
const reportRequests = new Map();
let deviceApprovalAbortController = null;
let todayTimesheetReportDate = null;
let timerStateConfirmed = false;
let serverReachable = true;
let timerLockActive = false;
let timerStartInFlight = false;
const IDLE_CHECK_INTERVAL_MS = 5000;
const DATA_REFRESH_INTERVAL_MS = 30 * 1000;
const API_REQUEST_TIMEOUT_MS = 10 * 1000;

const showTimerView = (viewName) => {
  timerViewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.timerPanel !== viewName;
  });

  timerNavigationButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.timerView === viewName);
  });

  const user = getStoredUser();
  if (user) localStorage.setItem(`desktop-view:${user._id || user.email || "user"}`, viewName);
};

timerNavigationButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const viewName = button.dataset.timerView;

    showTimerView(viewName);

    if (viewName === "dashboard") {
      await loadTodayTimesheet();
    }
  });
});

if (accountMenuButton) {
  accountMenuButton.addEventListener("click", () => {
    accountMenu.hidden = !accountMenu.hidden;
  });
}

document.addEventListener("click", (event) => {
  if (accountMenu && !event.target.closest(".account-area")) accountMenu.hidden = true;
});

if (addNoteButton) {
  addNoteButton.addEventListener("click", () => {
    timerNote.hidden = !timerNote.hidden;
    if (noteActions) noteActions.hidden = timerNote.hidden;
    addNoteButton.textContent = timerNote.hidden ? "Add note" : "Hide note";
    if (!timerNote.hidden) timerNote.focus();
  });
}

if (timerNote) {
  timerNote.addEventListener("input", () => {
    noteDirty = true;
    if (noteSaveStatus) noteSaveStatus.textContent = selectedTaskId
      ? "Unsaved changes. Click Save note."
      : "Select a task, then click Save note.";
  });
}

if (saveNoteButton) {
  saveNoteButton.addEventListener("click", saveNote);
}

function getToken() {
  return localStorage.getItem("token");
}

async function fetchAllPages(endpoint, collectionKey, token, { isCurrent, reportSync = false, force = false } = {}) {
  if (!reportSync) return loadAllPages(endpoint, collectionKey, token, { isCurrent });
  const key = JSON.stringify([token, endpoint, collectionKey]);
  const pending = reportRequests.get(key);
  if (pending) {
    // A manual refresh must follow the background result, rather than let
    // either response overwrite a more recent complete snapshot.
    if (!force) return pending;
    try { await pending; } catch { /* Retry a failed background load. */ }
    if (getToken() !== token || (isCurrent && !isCurrent())) return { items: [], cancelled: true };
    return fetchAllPages(endpoint, collectionKey, token, { isCurrent, reportSync, force });
  }
  const operation = loadAllPages(endpoint, collectionKey, token, { isCurrent, reportSync, force });
  reportRequests.set(key, operation);
  try { return await operation; } finally {
    if (reportRequests.get(key) === operation) reportRequests.delete(key);
  }
}

async function loadAllPages(endpoint, collectionKey, token, { isCurrent, reportSync = false, force = false } = {}) {
  const items = [];
  let page = 1;
  let data = {};
  let response;
  const cacheKey = JSON.stringify([token, endpoint, collectionKey]);
  const previous = reportSync ? reportSnapshots.get(cacheKey) : null;
  const marker = !force && previous && Date.now() - previous.loadedAt < 5 * 60_000 ? previous.data.sync : null;
  let firstPage;

  do {
    const separator = endpoint.includes("?") ? "&" : "?";
    const syncQuery = reportSync ? `&sync=true${page === 1 && marker
      ? `&syncSince=${encodeURIComponent(marker.since)}&syncScope=${encodeURIComponent(marker.scope)}&syncReferences=${encodeURIComponent(marker.references)}` : ""}` : "";
    response = await fetch(`${endpoint}${separator}page=${page}&limit=100${syncQuery}`, {
      method: "GET",
      // Project and task lists revalidate with their ETag, so an unchanged
      // list costs a body-less 304; edits change the ETag at once. Report
      // syncs run their own delta protocol and are never stored.
      cache: reportSync ? "no-store" : "no-cache",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    });
    data = await response.json();
    if (!response.ok) return { response, data, items: [] };
    if (isCurrent && !isCurrent()) return { response, data, items: [], cancelled: true };
    if (getToken() !== token) return { response, data, items: [], cancelled: true };
    firstPage ||= data;
    if (page === 1 && reportSync && marker && data.delta && previous) {
      const merged = new Map(previous.items.map((row) => [String(row._id), row]));
      for (const id of data.removedIds || []) merged.delete(String(id));
      for (const row of data[collectionKey] || []) merged.set(String(row._id), row);
      items.push(...[...merged.values()].sort((a, b) =>
        (new Date(b.startedAt || 0) - new Date(a.startedAt || 0)) || String(b._id).localeCompare(String(a._id))));
      data = { ...previous.data, ...data, delta: false, count: items.length, totalRecords: items.length, [collectionKey]: items };
      break;
    }
    items.push(...(Array.isArray(data[collectionKey]) ? data[collectionKey] : []));
    page += 1;
  } while (page <= Math.max(Number(data.totalPages) || 1, 1));

  if (reportSync) {
    const unique = [...new Map(items.map((row) => [String(row._id), row])).values()];
    items.length = 0;
    for (const row of unique) items.push(row);
    data = { ...firstPage, ...data, sync: firstPage.sync, [collectionKey]: items, count: items.length };
    if (firstPage.sync && items.length <= 50_000) {
      reportSnapshots.delete(cacheKey);
      while (reportSnapshots.size >= 12) reportSnapshots.delete(reportSnapshots.keys().next().value);
      reportSnapshots.set(cacheKey, { data, items: [...items], loadedAt: firstPage.delta ? previous.loadedAt : Date.now() });
    } else reportSnapshots.delete(cacheKey);
  }

  return { response, data, items };
}

function getOpenPauseReason(timeLog) {
  const openPause = [...(timeLog?.pauses || [])]
    .reverse()
    .find((pause) => !pause.resumedAt);

  return openPause?.reason || "manual";
}

function isIntentionalBreak(timeLog = currentTimeLog) {
  return timeLog?.status === "paused" && ["break", "manual"].includes(getOpenPauseReason(timeLog));
}

// A task can itself be typed "break" (e.g. Lunch), in which case every
// second it runs is break time by definition - not a pause layered on top
// of a work task. This is the same classification billingUtils.js uses to
// keep break tasks out of billable/worked totals.
function isBreakTask(timeLog = currentTimeLog) {
  return timeLog?.task?.taskType === "break";
}

function runningStatusLabel(timeLog = currentTimeLog) {
  return isBreakTask(timeLog) ? "On Break" : "Working";
}

function setClassState(element, className, enabled) {
  if (!element?.classList) return;
  if (enabled) element.classList.add(className);
  else element.classList.remove(className);
}

// Shared classification used by both the "Idle time" total and the timeline
// table so they can never disagree: any pause reason other than an
// intentional break/manual pause counts as idle.
function isIdlePauseReason(reason) {
  return !["break", "manual"].includes(reason);
}

function normalizedDesktopPolicy(policy = {}) {
  const idle = Number(policy.idleThresholdMinutes);
  const thresholdMinutes = Number.isInteger(idle)
    && idle >= idleDefaults.minIdleMinutes
    && idle <= idleDefaults.maxIdleMinutes
    ? idle
    : idleDefaults.idleThresholdMinutes;
  const logout = Number(policy.autoLogoutMinutes);
  const logoutMinutes = Number.isInteger(logout)
    && logout >= idleDefaults.minLogoutMinutes
    && logout <= idleDefaults.maxLogoutMinutes
    && logout > thresholdMinutes
    ? logout
    : Math.max(idleDefaults.autoLogoutMinutes, thresholdMinutes + 1);
  return {
    // Local testing override: set idleWarningTestSeconds to 30 in the shared
    // defaults, then restore it to 0 to use the administrator's minute policy.
    thresholdSeconds: Number(idleDefaults.idleWarningTestSeconds) > 0
      ? Number(idleDefaults.idleWarningTestSeconds) : thresholdMinutes * 60,
    logoutSeconds: logoutMinutes * 60,
    exempt: Boolean(policy.idleTrackingExempt),
  };
}

async function loadIdlePolicy() {
  const token = getToken();
  if (!token || logoutPending || !window.electronAPI?.getSystemIdleTime) return;
  if (!idleDefaults) idleDefaults = await window.electronAPI.getIdleDefaults();
  // Retain the last known policy during an outage; use shared defaults on first load.
  idlePolicy ||= normalizedDesktopPolicy();
  try {
    const response = await fetch(API_BASE_URL + "/settings/idle-policy", {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return;
    const data = await response.json();
    if (getToken() === token && !logoutPending) idlePolicy = normalizedDesktopPolicy(data.idlePolicy);
  } catch {
    // OS-idle security monitoring continues with the last policy or safe defaults.
  }
}

// Full-screen lock (see timer-lock.js) while no timer is running. It fails
// open when the timer state is unconfirmed or the server is unreachable:
// the employee could neither start a timer to unlock nor reach the network
// settings hidden behind the overlay.
function getTimerLockState() {
  if (isLoginPage || !getToken() || logoutPending || appClosePending) return "inactive";
  if (!timerStateConfirmed || !serverReachable) return "inactive";
  if (pendingIdleStop) return "locked";
  // Lift the lock as soon as Start is sent rather than when the server
  // answers (a few seconds); a failed start locks the screen again.
  if (timerStartInFlight) return "running";
  return currentTimeLog?.status === "running" || isIntentionalBreak(currentTimeLog) ? "running" : "locked";
}

function syncTimerLock(state = getTimerLockState()) {
  const locked = state === "locked";
  // Show the Start controls as the lock appears.
  if (locked && !timerLockActive) showTimerView("timer");
  timerLockActive = locked;
  if (timerLockNotice) timerLockNotice.hidden = !locked;
  window.electronAPI?.setTimerLock?.(state);
}

function noteServerResponse(response) {
  serverReachable = response.status < 500;
}

function clearSessionLoops() {
  syncTimerLock("inactive");
  reportSnapshots.clear();
  deviceApprovalAbortController?.abort();
  deviceApprovalAbortController = null;
  deviceApprovalMonitorActive = false;
  clearInterval(idleMonitorInterval);
  clearInterval(timerHeartbeatInterval);
  clearInterval(idlePolicyRefreshInterval);
  clearInterval(timerInterval);
  clearInterval(dataRefreshInterval);
  idleMonitorInterval = idlePolicyRefreshInterval = timerInterval = dataRefreshInterval = null;
  timerHeartbeatInterval = null;
  automaticIdlePause = false;
  lastIdleNoticeKey = null;
  idleAcknowledgedAt = null;
  pendingIdleStop = null;
  clearIdleNoticeDisplay();
  if (idleStartedDialog?.open) idleStartedDialog.close();
}

async function runTimerAction(action) {
  if (logoutPending || appClosePending || !getToken() || timerAction || idleStartedDialog?.open) return;
  timerAction = action();
  updateBreakUI();
  try { return await timerAction; } finally {
    timerAction = null;
    updateBreakUI();
    syncTimerLock();
  }
}

async function signOut(inactivity = false) {
  if (logoutInProgress || !getToken()) return;
  logoutInProgress = true;
  logoutPending = true;
  automaticIdlePause = false;
  syncTimerLock();
  const token = getToken();
  try {
    // Finish an already submitted timer action before closing the timer.
    if (timerAction) await timerAction;
    {
      [startTimerButton, pauseTimerButton, resumeTimerButton, stopTimerButton, stopBreakButton].forEach(button => {
        if (button) button.disabled = true;
      });
      const response = await fetch(API_BASE_URL + "/time-logs/active", {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const data = await response.json();
        currentTimeLog = data.timeLog || null;
        if (["running", "paused"].includes(currentTimeLog?.status)) {
          const stopResponse = await fetch(API_BASE_URL + "/time-logs/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({ logoutReason: inactivity ? "inactivity" : "manual",
              ...(pendingIdleStop ? { idleSeconds: Math.max(1, Math.floor((Date.now() - pendingIdleStop.startedAt) / 1000)) } : {}) }),
            signal: AbortSignal.timeout(10000),
          });
          if (!stopResponse.ok && stopResponse.status !== 404) throw new Error("Timer close pending");
          currentTimeLog = null;
        }
      } else if (response.status !== 401 && response.status !== 403) {
        throw new Error("Timer status unavailable");
      }
    }
    const rememberedSessionToken = localStorage.getItem("rememberedSessionToken");
    try {
      await fetch(API_BASE_URL + "/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        // Manual sign-out ends only the active session and keeps this trusted
        // device available for password-free return. Inactivity sign-out is a
        // security boundary, so it also revokes the remembered credential.
        body: JSON.stringify(inactivity ? { rememberedSessionToken } : {}),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Once pause is confirmed, local sign-out completes even if logout is offline.
    }
    clearSessionLoops();
    currentTimeLog = null;
    if (timerDuration) timerDuration.textContent = "00:00:00";
    if (timerStatus) timerStatus.textContent = "Idle";
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (inactivity) {
      localStorage.removeItem("rememberedSessionToken");
      localStorage.removeItem("rememberedUser");
    }
    ["activeTimer", "currentTimeLog", "timerState", "timerStartedAt", "timerElapsedSeconds"].forEach(key => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    if (inactivity) {
      sessionStorage.setItem("inactivityLogout", "1");
      // Read the configured minutes right now (not a value cached earlier in
      // this session) so the login page can show the policy that actually
      // triggered this logout; idlePolicy itself does not survive the
      // upcoming full-page navigation to index.html.
      const logoutMinutes = idlePolicy ? Math.round(idlePolicy.logoutSeconds / 60) : NaN;
      if (Number.isFinite(logoutMinutes) && logoutMinutes > 0) {
        sessionStorage.setItem("inactivityLogoutMinutes", String(logoutMinutes));
      }
    }
    window.location.replace("./index.html");
  } catch {
    // Never discard the access token needed to close a potentially active backend timer.
    // Keep timer controls locked and retry through the SAME idle loop after an outage.
    if (timerMessage) timerMessage.textContent = "CRM is waiting for a connection to pause your timer and sign you out.";
  } finally {
    logoutInProgress = false;
  }
}

function clearIdleNoticeDisplay() {
  clearInterval(idleNoticeInterval);
  idleNoticeInterval = null;
  idleNoticeSnapshot = null;
}

function getIdleNoticeSeconds() {
  if (!idleNoticeSnapshot) return 0;
  return Math.max(0, Math.floor(idleNoticeSnapshot.seconds + (Date.now() - idleNoticeSnapshot.observedAt) / 1000));
}

function updateIdleStartedPopup() {
  if (!idleStartedDialog?.open || !idlePolicy) return;
  if (!idleNoticeSnapshot) return;
  // This interval only paints the notice. OS-idle polling remains the sole
  // source for activity, stopping the timer and enforcing automatic logout.
  const inactive = getIdleNoticeSeconds();
  const remaining = Math.max(0, idlePolicy.logoutSeconds - inactive);
  idleStartedDuration.textContent = inactive < 60
    ? `${String(inactive).padStart(2, "0")} secs`
    : `${String(Math.floor(inactive / 60)).padStart(2, "0")} mins`;
  idleLogoutCountdown.textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")} Mins ${String(remaining % 60).padStart(2, "0")} Secs`;
}

function showIdleStartedPopup(timeLog, idleSeconds) {
  if (!idleStartedDialog || typeof idleStartedDialog.showModal !== "function") return;
  const noticeKey = timeLog?._id || timeLog?.stoppedAt;
  if (noticeKey && noticeKey === lastIdleNoticeKey) return;
  lastIdleNoticeKey = noticeKey;
  const idlePause = [...(timeLog?.pauses || [])].reverse().find((pause) => pause.reason === "idle");
  const idleStart = validTimelineTime(idlePause?.pausedAt);
  idleStartedTime.textContent = idleStart === null ? "" : `Idle started at ${new Date(idleStart).toLocaleTimeString()}.`;
  idleStartedTime.hidden = idleStart === null;
  if (!idleStartedDialog.open) idleStartedDialog.showModal();
  clearIdleNoticeDisplay();
  idleNoticeSnapshot = { seconds: idleSeconds, observedAt: Date.now() };
  updateIdleStartedPopup();
  idleNoticeInterval = setInterval(updateIdleStartedPopup, 1000);
}

async function checkSystemIdleState() {
  // Every poll re-reports the lock state; main releases the lock if reports stop.
  syncTimerLock();
  if (idleCheckInProgress || appClosePending || !idlePolicy || !getToken()) return;
  idleCheckInProgress = true;
  try {
    const systemIdleSeconds = await window.electronAPI.getSystemIdleTime();
    if (!getToken()) return;
    // Returning activity does not acknowledge an open warning. The employee
    // must press Continue; until then its inactivity/countdown remains live.
    const idleSeconds = idleStartedDialog?.open ? getIdleNoticeSeconds()
      : idleAcknowledgedAt === null ? systemIdleSeconds
        : Math.min(systemIdleSeconds, Math.max(0, Math.floor((Date.now() - idleAcknowledgedAt) / 1000)));
    updateIdleStartedPopup();
    // Close the work session at the first idle poll. The backend records the
    // preceding OS-idle interval as an idle pause, not as worked time.
    if (!isIntentionalBreak() && !idlePolicy.exempt
      && currentTimeLog?.status === "running" && !isBreakTask()
      && (pendingIdleStop || idleSeconds >= idlePolicy.thresholdSeconds)) {
      if (!pendingIdleStop) {
        pendingIdleStop = { startedAt: Date.now() - idleSeconds * 1000 };
        stopLiveDuration();
        const frozen = { ...currentTimeLog, pauses: [...(currentTimeLog.pauses || []),
          { reason: "idle", pausedAt: new Date(pendingIdleStop.startedAt).toISOString() }] };
        timerDuration.textContent = formatDuration(calculateCurrentWorkSeconds(frozen));
        if (pauseTimerButton) pauseTimerButton.disabled = true;
        if (resumeTimerButton) resumeTimerButton.disabled = true;
        // Lock the screen now rather than after the stop request returns.
        syncTimerLock();
      }
      await runTimerAction(() => stopTimer({ idleSeconds: Math.max(idleSeconds,
        Math.floor((Date.now() - pendingIdleStop.startedAt) / 1000)) }));
    }
    // Session-level auto-logout applies to every logged-in session regardless
    // of timer state, task type, intentional break, or the old per-task flag.
    // (idlePolicy.exempt intentionally does NOT block this - it only exempts
    // an employee's active work from being auto-paused for idleness, see below.)
    if (logoutPending || idleSeconds >= idlePolicy.logoutSeconds) {
      await signOut(true);
      return;
    }
    // Activity never resumes an idle-ended task. Continue acknowledges the
    // warning; Start explicitly opens the next session on the selected task.
  } catch {
    if (timerMessage) timerMessage.textContent = "CRM could not check inactivity. Please try again.";
  } finally {
    idleCheckInProgress = false;
  }
}

function startIdleMonitor() {
  clearInterval(idleMonitorInterval);
  idleMonitorInterval = null;
  if (!idlePolicy || !getToken() || isLoginPage) return;
  idleMonitorInterval = setInterval(checkSystemIdleState, IDLE_CHECK_INTERVAL_MS);
}
window.addEventListener("beforeunload", clearSessionLoops);
function updateProfileUI(user) {
  profileFullName.textContent =
    user.fullName || "Not available";

  profileEmployeeId.textContent =
    user.employeeId || "Not available";

  profileRole.textContent =
    user.role || "Not available";

  profileDepartment.textContent =
    user.department || "Not available";

  profileDesignation.textContent =
    user.designation || "Not available";

  profileEmail.textContent =
    user.email || "Not available";

  profileStatus.textContent =
    user.isActive ? "Active" : "Inactive";
}
function getStoredUser() {
  const storedUser = localStorage.getItem("user");

  if (!storedUser) {
    return null;
  }

  try {
    return JSON.parse(storedUser);
  } catch {
    return null;
  }
}

// Work selection state. The project/task <select> elements are rebuilt when
// data refreshes, so the employee's choice is kept here by MongoDB _id and
// re-applied after every rebuild instead of being read back from the DOM.
let selectedProjectId = "";
let selectedTaskId = "";
let selectedClientId = "";
let activeClients = [];
let clientsLoaded = false;
let clientLoadFailed = false;
let clientRequestId = 0;
let projectsSignature = null;
let clientOptionsSignature = null;
let tasksSignature = null;
let tasksProjectId = "";
let projectRequestId = 0;
let taskRequestId = 0;

function getWorkSelectionStorageKey() {
  const user = getStoredUser();
  return `desktop-work-selection:${user?._id || user?.email || "user"}`;
}

async function sendTimerHeartbeat() {
  if (!getToken() || !currentTimeLog?.desktopHeartbeatAt || appClosePending || logoutPending) return;
  try {
    const response = await fetch(`${API_BASE_URL}/time-logs/heartbeat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    });
    noteServerResponse(response);
    if (response.status === 404) {
      currentTimeLog = null;
      stopLiveDuration();
      timerMessage.textContent = "The timer stopped because the server stopped receiving confirmation from this app. Time is recorded up to the last confirmed moment. Start a new timer to continue work.";
      await loadActiveTimer();
      await loadTodayTimesheet();
    }
  } catch {
    // The server closes the timer at its last confirmed heartbeat if contact
    // is lost; a transient error is retried on the next interval.
    serverReachable = false;
  }
}

function startTimerHeartbeat() {
  clearInterval(timerHeartbeatInterval);
  timerHeartbeatInterval = setInterval(sendTimerHeartbeat, 20_000);
}

async function stopTimerForAppClose() {
  const token = getToken();
  if (!token) return true;

  appClosePending = true;
  automaticIdlePause = false;
  try {
    if (timerAction) await timerAction;
    const response = await fetch(API_BASE_URL + "/time-logs/stop", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Timer stop failed with HTTP ${response.status}`);
    }
    currentTimeLog = null;
    setSelectedTaskId("", "app close stopped timer");
    if (taskSelect) taskSelect.value = "";
    clearSessionLoops();
    return true;
  } catch (error) {
    console.error("[desktop-close] Unable to stop the active timer:", error.message);
    appClosePending = false;
    if (timerMessage) {
      timerMessage.textContent = "The timer could not be stopped because the server did not confirm it. Check your connection and close the app again.";
    }
    window.electronAPI?.notifyCloseCancelled?.();
    return false;
  }
}

window.electronAPI?.onBeforeClose?.(async () => {
  const stopped = await stopTimerForAppClose();
  if (stopped) window.electronAPI.notifyCloseReady?.();
});

function getNoteDraftStorageKey(projectId = selectedProjectId, taskId = selectedTaskId) {
  if (!projectId || !taskId) return null;
  const user = getStoredUser();
  return `desktop-note-draft:${user?._id || user?.email || "user"}:${projectId}:${taskId}`;
}

function readNoteDraft() {
  const key = getNoteDraftStorageKey();
  return key ? localStorage.getItem(key) || "" : "";
}

function saveNoteDraft(note) {
  const key = getNoteDraftStorageKey();
  if (!key) return;
  const value = String(note || "").slice(0, 2000);
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

function clearNoteDraft() {
  const key = getNoteDraftStorageKey();
  if (key) localStorage.removeItem(key);
}

function restoreWorkSelection() {
  try {
    const saved = JSON.parse(localStorage.getItem(getWorkSelectionStorageKey()) || "{}");
    selectedProjectId = String(saved.projectId || "");
    selectedTaskId = String(saved.taskId || "");
    selectedClientId = String(saved.clientId || "");
  } catch {
    selectedProjectId = "";
    selectedTaskId = "";
    selectedClientId = "";
  }
}

function saveWorkSelection() {
  localStorage.setItem(getWorkSelectionStorageKey(), JSON.stringify({
    projectId: selectedProjectId,
    taskId: selectedTaskId,
    clientId: selectedClientId,
  }));
}

function setSelectedProjectId(projectId, source) {
  const nextProjectId = String(projectId || "");
  if (nextProjectId === selectedProjectId) return;
  selectedProjectId = nextProjectId;
  // The current API exposes a shared active-client catalog. A client remains
  // valid across projects; only clear it when the project is cleared or the
  // refreshed authorized catalog no longer contains it.
  if (!nextProjectId) selectedClientId = "";
  saveWorkSelection();
}

function setSelectedTaskId(taskId, source) {
  const nextTaskId = String(taskId || "");
  if (nextTaskId === selectedTaskId) return;
  selectedTaskId = nextTaskId;
  noteDirty = false;
  saveWorkSelection();
  if (!currentTimeLog) updateNoteControlsUI(null);
}

const hasOption = (select, value) =>
  Boolean(value) && [...select.options].some((option) => option.value === value);

// Adds an option for a restored active timer whose project/task is no longer
// in the assignable list, so the running work is still displayed.
function ensureOption(select, value, label) {
  if (!value || hasOption(select, value)) return;
  select.appendChild(new Option(label || "Unavailable", value));
  if (select === projectSelect) projectsSignature = null;
  if (select === taskSelect) tasksSignature = null;
}

function updateClientName() {
  if (!clientSelect) return;
  const hasProject = Boolean(selectedProjectId || currentTimeLog?.project);
  const clients = hasProject ? activeClients : [];
  const placeholder = !hasProject ? "Select project first"
    : !clientsLoaded ? clientLoadFailed ? "Unable to load clients" : "Loading clients..."
      : clients.length ? "Select client" : "No clients available";
  const signature = JSON.stringify([placeholder, clients]);
  if (signature !== clientOptionsSignature) {
    clientSelect.replaceChildren(
      new Option(placeholder, ""),
      ...clients.map((client) => new Option(client.clientName, client._id))
    );
    clientOptionsSignature = signature;
  }
  const activeClientId = String(currentTimeLog?.client?._id || currentTimeLog?.client || "");
  if (activeClientId && !hasOption(clientSelect, activeClientId)) {
    clientSelect.appendChild(new Option(currentTimeLog?.client?.clientName || "Previously selected client", activeClientId));
  }
  const nextClientId = [activeClientId, selectedClientId, clients.length === 1 ? clients[0]._id : ""]
    .find((id) => hasOption(clientSelect, id)) || "";
  clientSelect.value = nextClientId;
  // A failed/unfinished request is not evidence that a saved client vanished.
  if ((clientsLoaded || activeClientId) && selectedClientId !== nextClientId) {
    selectedClientId = nextClientId;
    saveWorkSelection();
  }
  clientSelect.disabled = Boolean(currentTimeLog) || !hasProject || !clientsLoaded || clients.length === 0;
}

async function loadClients() {
  const token = getToken();
  if (!token || !clientSelect) return false;
  const requestId = ++clientRequestId;
  const isCurrent = () => requestId === clientRequestId && token === getToken();
  const requestUrl = `${API_BASE_URL}/clients`;
  updateClientName();

  try {
    const response = await fetch(requestUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    if (!isCurrent()) return false;
    if (!response.ok) {
      throw new Error(`Client request failed (HTTP ${response.status}).`);
    }
    if (!Array.isArray(data.clients)) throw new Error("Client API returned an invalid clients list.");
    // Match the existing {_id, clientName, status} response. Never use a
    // display name as the timer's client ID or synthesize clients from projects.
    activeClients = [...new Map(data.clients
      .filter((client) => client?._id && typeof client.clientName === "string" && client.clientName.trim() && client.status !== "Inactive")
      .map((client) => [String(client._id), { _id: String(client._id), clientName: client.clientName, status: client.status }])).values()];
    clientsLoaded = true;
    clientLoadFailed = false;
    updateClientName();
    if (localStorage.getItem("debug-time-tracker") === "true") console.debug("[TimeTracker] Clients loaded", {
      projectId: selectedProjectId,
      employeeId: getStoredUser()?._id || null,
      endpoint: requestUrl,
      returned: data.clients.length,
      available: activeClients.length,
      scope: "authenticated active-client catalog",
    });
    return true;
  } catch (error) {
    if (!isCurrent()) return false;
    clientLoadFailed = true;
    updateClientName();
    workSelectionMessage.textContent = "Unable to load clients. Check your connection and try again.";
    console.warn(`[TimeTracker] ${error.message || "Unable to load clients"}`);
    return false;
  }
}

function renderTaskPlaceholder(text) {
  tasksSignature = null;
  taskSelect.replaceChildren(new Option(text, ""));
  taskSelect.disabled = true;
}

async function loadProjects() {
  const token = getToken();

  if (!token || !projectSelect) {
    return false;
  }

  const requestId = ++projectRequestId;

  try {
    // Only active projects can be started (see POST /time-logs/start).
    const { response, data, items: projects, cancelled } = await fetchAllPages(
      `${API_BASE_URL}/projects?status=Active`,
      "projects",
      token,
      { isCurrent: () => requestId === projectRequestId }
    );

    if (cancelled || requestId !== projectRequestId) return false;

    if (!response.ok) {
      // Keep the current options and selection; a failed refresh must not
      // wipe what the employee has already chosen.
      workSelectionMessage.textContent =
        data.message || "Unable to load projects.";

      return false;
    }

    // Rebuilding the options closes an open dropdown and momentarily shows
    // the placeholder, so only rebuild when the project list really changed.
    const signature = JSON.stringify(projects.map((project) => [project._id, project.projectName]));

    if (signature !== projectsSignature) {
      projectSelect.replaceChildren(
        new Option("Select Project", ""),
        ...projects.map((project) => {
          const option = new Option(project.projectName, project._id);
          return option;
        })
      );
      projectsSignature = signature;
    }

    if (selectedProjectId && !hasOption(projectSelect, selectedProjectId) && !currentTimeLog) {
      setSelectedProjectId("", "loadProjects: project is no longer active or assigned");
      setSelectedTaskId("", "loadProjects: project is no longer active or assigned");
    }

    projectSelect.value = selectedProjectId;
    updateClientName();
    workSelectionMessage.textContent = "";
    return true;
  } catch (error) {
    if (requestId === projectRequestId) {
      workSelectionMessage.textContent =
        "Unable to reach the backend server.";
    }
    return false;
  }
}

async function loadTasks(projectId, { background = false } = {}) {
  if (!taskSelect) return;

  const token = getToken();
  const requestId = ++taskRequestId;

  if (!projectId || !token) {
    tasksProjectId = "";
    renderTaskPlaceholder("Select Task");
    return;
  }

  // A background refresh keeps the current options until the response
  // arrives, so the chosen task never flickers back to the placeholder.
  const keepExistingTasks = background && tasksProjectId === projectId && tasksSignature !== null;
  if (!keepExistingTasks) {
    tasksProjectId = projectId;
    renderTaskPlaceholder("Loading tasks...");
  }

  try {
    const { response, data, items: projectTasks, cancelled } = await fetchAllPages(
      `${API_BASE_URL}/tasks?project=${encodeURIComponent(projectId)}&active=true`,
      "tasks",
      token,
      { isCurrent: () => requestId === taskRequestId && projectId === selectedProjectId }
    );

    // Ignore responses for a project the employee has already moved away from.
    if (cancelled || requestId !== taskRequestId || projectId !== selectedProjectId) return;

    if (!response.ok) {
      if (keepExistingTasks) return;
      renderTaskPlaceholder("Unable to load tasks");
      workSelectionMessage.textContent =
        data.message || "Unable to load tasks.";

      return;
    }

    // Break tasks can be assigned without a project. Show those alongside
    // the selected project's tasks so employees can start a break session.
    const breakResult = await fetchAllPages(
      `${API_BASE_URL}/tasks?taskType=break&active=true`,
      "tasks",
      token,
      { isCurrent: () => requestId === taskRequestId && projectId === selectedProjectId }
    );
    if (breakResult.cancelled || requestId !== taskRequestId || projectId !== selectedProjectId) return;
    if (!breakResult.response.ok) {
      if (keepExistingTasks) return;
      renderTaskPlaceholder("Unable to load tasks");
      workSelectionMessage.textContent = breakResult.data.message || "Unable to load break tasks.";
      return;
    }
    const tasks = [...new Map([
      ...projectTasks,
      ...breakResult.items.filter((task) => !task.project),
    ].map((task) => [task._id, task])).values()];

    if (tasks.length === 0) {
      renderTaskPlaceholder("No tasks available for this project");
      if (!currentTimeLog) setSelectedTaskId("", "loadTasks: project has no available tasks");
      return;
    }

    const signature = JSON.stringify(
      tasks.map((task) => [task._id, task.taskName, task.taskType, task.idleLogout === true])
    );

    if (signature !== tasksSignature) {
      taskSelect.replaceChildren(
        new Option("Select Task", ""),
        ...tasks.map((task) => {
          const option = new Option(
            task.taskType === "break" ? `${task.taskName} (Break)` : task.taskName,
            task._id
          );
          option.dataset.idleLogout = String(task.idleLogout === true);
          option.dataset.taskType = task.taskType || "work";
          return option;
        })
      );
      tasksSignature = signature;
    }

    if (selectedTaskId && !hasOption(taskSelect, selectedTaskId) && !currentTimeLog) {
      setSelectedTaskId("", "loadTasks: task is no longer active or assigned");
    }

    taskSelect.value = selectedTaskId;
    taskSelect.disabled = Boolean(currentTimeLog);
    workSelectionMessage.textContent = "";
  } catch (error) {
    if (requestId !== taskRequestId || projectId !== selectedProjectId || keepExistingTasks) return;
    renderTaskPlaceholder("Unable to load tasks");
    workSelectionMessage.textContent =
      "Unable to reach the backend server.";
  }
}

function formatTime(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function endRevokedDeviceSession(reason = "This account is now active on another device.") {
  deviceApprovalMonitorActive = false;
  clearSessionLoops();
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  ["activeTimer", "currentTimeLog", "timerState", "timerStartedAt", "timerElapsedSeconds"].forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
  sessionStorage.setItem("sessionEndedMessage", reason);
  window.location.replace("./index.html");
}

async function waitForDeviceApproval(loginRequest) {
  const activeDevice = loginRequest.activeDevice?.deviceName || "the other computer";
  message.classList.add("approval-pending");
  message.textContent = `Approve this login in CRM on ${activeDevice}: choose "Allow New Device". If that computer is unavailable, close CRM there and try again in about 5 minutes.`;
  loginButton.textContent = "Waiting for approval...";
  while (loginInProgress) {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}/auth/login-requests/${encodeURIComponent(loginRequest.requestId)}/wait`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestToken: loginRequest.requestToken }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      // The server holds this request for up to 20 seconds. A slow response
      // should not abandon an otherwise valid approval request.
      if (error.name === "TimeoutError" && Date.now() < new Date(loginRequest.expiresAt).getTime()) continue;
      throw error;
    }
    const data = await response.json();
    if (response.status === 202) continue;
    if (!response.ok) {
      message.classList.remove("approval-pending");
      message.textContent = data.message || "The login request was not approved.";
      return null;
    }
    message.classList.remove("approval-pending");
    return data;
  }
  return null;
}

function showDeviceLoginRequest(loginRequest) {
  pendingDeviceLoginRequest = loginRequest;
  requestingDeviceName.textContent = loginRequest.deviceName || "Another device";
  deviceLoginMessage.textContent = "";
  keepThisDeviceButton.disabled = false;
  allowNewDeviceButton.disabled = false;
  deviceLoginModal.hidden = false;
}

async function monitorDeviceLoginRequests() {
  if (deviceApprovalMonitorActive || isLoginPage || !getToken()) return;
  deviceApprovalMonitorActive = true;
  deviceApprovalAbortController?.abort();
  const controller = new AbortController();
  deviceApprovalAbortController = controller;
  while (deviceApprovalMonitorActive && getToken() && !logoutPending) {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login-requests/pending`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if ([401, 403].includes(response.status)) {
        endRevokedDeviceSession(data.message);
        return;
      }
      if (response.ok && data.loginRequest) {
        showDeviceLoginRequest(data.loginRequest);
        deviceApprovalMonitorActive = false;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error.name !== "TimeoutError") await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function decideDeviceLogin(decision) {
  if (!pendingDeviceLoginRequest) return;
  keepThisDeviceButton.disabled = true;
  allowNewDeviceButton.disabled = true;
  deviceLoginMessage.textContent = decision === "allow" ? "Authorizing the new device..." : "Keeping this device active...";
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login-requests/${encodeURIComponent(pendingDeviceLoginRequest.requestId)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ decision }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unable to save the decision.");
    if (decision === "allow") {
      endRevokedDeviceSession("You allowed this account to continue on the new device.");
      return;
    }
    pendingDeviceLoginRequest = null;
    deviceLoginModal.hidden = true;
    void monitorDeviceLoginRequests();
  } catch (error) {
    deviceLoginMessage.textContent = error.message;
    keepThisDeviceButton.disabled = false;
    allowNewDeviceButton.disabled = false;
  }
}

async function refreshCurrentUser() {
  const token = getToken();
  if (!token || isLoginPage || logoutPending) return true;
  try {
    const response = await fetch(API_BASE_URL + "/auth/me", {
      cache: "no-store",
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(10000),
    });
    noteServerResponse(response);
    if ([401, 403].includes(response.status)) {
      const data = await response.json().catch(() => ({}));
      endRevokedDeviceSession(data.message);
      return false;
    }
    syncTimerLock();
    if (!response.ok) return true;
    const data = await response.json();
    const user = data.user || data;
    localStorage.setItem("user", JSON.stringify(user));
    // Background refresh: update the header/profile only. showLoggedInView
    // would also force the Timer tab every refresh.
    updateUserDetails(user);
    return true;
  } catch {
    serverReachable = false;
    syncTimerLock();
    return true;
  }
}

let desktopRefreshInFlight = null;

// The interval, window focus and visibilitychange can fire together. Sharing
// one in-flight refresh stops overlapping runs from reading each other's
// half-rebuilt dropdowns.
function refreshDesktopData() {
  if (!desktopRefreshInFlight) {
    desktopRefreshInFlight = runDesktopRefresh().finally(() => {
      desktopRefreshInFlight = null;
    });
  }
  return desktopRefreshInFlight;
}

async function runDesktopRefresh() {
  if (isLoginPage || !getToken() || logoutPending) return;
  if (!(await refreshCurrentUser())) return;
  // Session validity is still checked while hidden; the heavier lists wait
  // until the window is visible again (the visibilitychange handler refreshes).
  if (document.visibilityState === "hidden") return;
  await loadTodayTimesheet();
  // An active timer owns the project/task display; it is restored from the
  // backend by loadActiveTimer, not by the background refresh.
  if (currentTimeLog) return;

  await loadClients();
  if (currentTimeLog) return;
  await loadProjects();
  if (currentTimeLog) return;
  await loadTasks(selectedProjectId, { background: true });
}

function getRememberedUser() {
  const storedUser = localStorage.getItem("rememberedUser");
  if (!storedUser) return null;
  try { return JSON.parse(storedUser); } catch { return null; }
}

function showLoggedInView(user) {
  if (loginSection) loginSection.hidden = true;
  if (appSection) appSection.hidden = false;
  const savedView = localStorage.getItem(`desktop-view:${user._id || user.email || "user"}`);
  showTimerView(savedView === "dashboard" ? "dashboard" : "timer");
  updateUserDetails(user);
}

function updateUserDetails(user) {
  userName.textContent = user.fullName || "Employee";
  userRole.textContent = (user.role || "employee").replace("_", " ");
  currentDate.textContent = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  updateProfileUI(user);
}

function showLoggedOutView() {
  if (loginSection) loginSection.hidden = false;
  if (appSection) appSection.hidden = true;
}

function appendTimesheetCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.appendChild(cell);
}

function appendSegmentCell(row, label, note) {
  const cell = document.createElement("td");
  cell.appendChild(document.createTextNode(label));
  if (note) {
    cell.title = note;
    const noteEl = document.createElement("div");
    noteEl.className = "timesheet-note";
    noteEl.textContent = note;
    cell.appendChild(noteEl);
  }
  row.appendChild(cell);
}

function validTimelineTime(value) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

function buildTimeLogTimeline(timeLog, now = Date.now()) {
  const sessionStart = validTimelineTime(timeLog?.startedAt);
  if (sessionStart === null) return [];
  const stoppedAt = validTimelineTime(timeLog?.stoppedAt);
  const sessionEnd = stoppedAt ?? now;
  if (sessionEnd < sessionStart) return [];

  const pauses = [...(timeLog.pauses || [])]
    .map((pause) => ({
      ...pause,
      startMs: validTimelineTime(pause.pausedAt),
      endMs: validTimelineTime(pause.resumedAt),
    }))
    .filter((pause) => pause.startMs !== null)
    .sort((first, second) => first.startMs - second.startMs);
  const counters = { work: 0, break: 0, idle: 0 };
  const entries = [];
  let cursor = sessionStart;
  const activeSegmentType = timeLog.task?.taskType === "break" ? "break" : "work";

  const addEntry = (type, startMs, endMs, open = false) => {
    if (endMs < startMs) return;
    counters[type] += 1;
    entries.push({
      type,
      sequence: counters[type],
      start: new Date(startMs),
      end: open ? null : new Date(endMs),
      milliseconds: Math.max(0, endMs - startMs),
      seconds: Math.max(0, Math.floor((endMs - startMs) / 1000)),
      open,
    });
  };

  pauses.forEach((pause) => {
    const pauseStart = Math.min(sessionEnd, Math.max(sessionStart, pause.startMs));
    if (pauseStart > cursor) addEntry(activeSegmentType, cursor, pauseStart);
    const openPause = pause.endMs === null && stoppedAt === null;
    const pauseEnd = Math.min(sessionEnd, Math.max(pauseStart, pause.endMs ?? sessionEnd));
    addEntry(isIdlePauseReason(pause.reason) ? "idle" : "break", pauseStart, pauseEnd, openPause);
    cursor = Math.max(cursor, pauseEnd);
  });

  if (cursor < sessionEnd || (entries.length === 0 && cursor === sessionEnd)) {
    addEntry(activeSegmentType, cursor, sessionEnd, stoppedAt === null);
  }

  const workEntries = entries.filter((entry) => entry.type === "work");
  const timestampWorkedSeconds = Math.floor(
    workEntries.reduce((total, entry) => total + entry.milliseconds, 0) / 1000
  );
  const targetWorkedSeconds = activeSegmentType === "work" && timeLog.status === "stopped"
    && Number.isFinite(Number(timeLog.totalWorkedSeconds))
    ? Math.floor(Math.max(0, Number(timeLog.totalWorkedSeconds)))
    : timestampWorkedSeconds;
  if (targetWorkedSeconds > 0 && workEntries.length === 0) {
    const reconciliationEntry = {
      type: "work",
      sequence: 1,
      start: new Date(sessionStart),
      end: new Date(sessionStart),
      milliseconds: 0,
      seconds: 0,
      open: false,
      reconciled: true,
    };
    entries.unshift(reconciliationEntry);
    workEntries.push(reconciliationEntry);
  }
  let workRemainder = targetWorkedSeconds
    - workEntries.reduce((total, entry) => total + entry.seconds, 0);
  const remainderOrder = [...workEntries].sort(
    (first, second) => (second.milliseconds % 1000) - (first.milliseconds % 1000)
  );
  for (let index = 0; workRemainder > 0 && remainderOrder.length; index += 1) {
    remainderOrder[index % remainderOrder.length].seconds += 1;
    workRemainder -= 1;
  }
  const reductionOrder = [...workEntries].sort((first, second) => second.seconds - first.seconds);
  for (let index = 0; workRemainder < 0 && reductionOrder.some((entry) => entry.seconds > 0); index += 1) {
    const entry = reductionOrder[index % reductionOrder.length];
    if (entry.seconds > 0) {
      entry.seconds -= 1;
      workRemainder += 1;
    }
  }
  return entries;
}

function appendTimelineTypeCell(row, entry, timeLog) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `timesheet-entry-badge timesheet-entry-${entry.type}`;
  badge.textContent = entry.type;
  cell.appendChild(badge);
  if (entry.type === "work") {
    const project = document.createElement("span");
    project.className = "timesheet-entry-project";
    project.textContent = timeLog.project?.projectName || "Unassigned";
    cell.appendChild(project);
  }
  row.appendChild(cell);
}

function buildChronologicalTimeline(timeLogs, now = Date.now()) {
  const rows = timeLogs
    .flatMap((timeLog, timeLogIndex) =>
      buildTimeLogTimeline(timeLog, now).map((entry, entryIndex) => ({
        timeLog,
        entry,
        timeLogIndex,
        entryIndex,
      }))
    )
    .sort((first, second) =>
      first.entry.start.getTime() - second.entry.start.getTime()
      || first.timeLogIndex - second.timeLogIndex
      || first.entryIndex - second.entryIndex
    );
  const dayKey = (time) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(time));
  const timeline = [];
  let previousEnd = null;
  let previousTimeLog = null;
  for (const row of rows) {
    const start = row.entry.start.getTime();
    if (previousEnd !== null && start > previousEnd && dayKey(previousEnd) === dayKey(start)) {
      const milliseconds = start - previousEnd;
      timeline.push({
        timeLog: previousTimeLog,
        entry: {
          type: "idle", source: "between_sessions", sequence: 0,
          start: new Date(previousEnd), end: new Date(start),
          milliseconds, seconds: Math.floor(milliseconds / 1000), open: false,
        },
      });
    }
    timeline.push(row);
    const end = row.entry.end?.getTime() ?? now;
    if (previousEnd === null || end >= previousEnd) {
      previousEnd = end;
      previousTimeLog = row.timeLog;
    }
  }
  return timeline;
}

function summarizeTimeline(timeline) {
  return timeline.reduce((totals, { entry }) => {
    if (entry.type === "work") totals.workSeconds += entry.seconds;
    if (entry.type === "idle") totals.idleSeconds += entry.seconds;
    if (entry.type === "break" && !entry.open) totals.breakSeconds += entry.seconds;
    return totals;
  }, { workSeconds: 0, breakSeconds: 0, idleSeconds: 0 });
}

function timesheetTaskId(timeLog) {
  const task = timeLog?.task;
  return String(typeof task === "object" ? task?._id || "" : task || "");
}

function getTimesheetView(timeLogs, { type = "all", taskId = "", status = "all" } = {}, now = Date.now()) {
  // Build gaps from the full history before filtering. A gap between two
  // sessions belongs to neither task and must not inflate a selected task.
  const timeline = buildChronologicalTimeline(timeLogs, now).filter(({ timeLog, entry }) => {
    if (type !== "all" && entry.type !== type) return false;
    if (taskId && (entry.source === "between_sessions" || timesheetTaskId(timeLog) !== taskId)) return false;
    if (status !== "all" && entry.source === "between_sessions") return false;
    if (status === "completed" && timeLog.status !== "stopped") return false;
    if (status === "active" && !["running", "paused"].includes(timeLog.status)) return false;
    return true;
  });
  const sessions = new Map();
  const totals = { workSeconds: 0, breakSeconds: 0, breakCount: 0, completedSessions: 0 };
  timeline.forEach(({ timeLog, timeLogIndex, entry }) => {
    if (entry.type === "work") totals.workSeconds += entry.seconds;
    if (entry.type === "break") {
      totals.breakSeconds += entry.seconds;
      totals.breakCount += 1;
    }
    if (entry.source !== "between_sessions") sessions.set(timeLog._id || timeLogIndex, timeLog);
  });
  totals.completedSessions = [...sessions.values()].filter((timeLog) => timeLog.status === "stopped").length;
  return { timeline, ...totals, sessions: sessions.size };
}

function renderTodayTimesheet(timeLogs, reportDate) {
  todayTimesheetLogs = timeLogs;
  todayTimesheetReportDate = reportDate;
  const reportNow = Date.now();
  const timeline = buildChronologicalTimeline(timeLogs, reportNow);
  const {
    workSeconds: totalSeconds,
    idleSeconds: totalIdleSeconds,
    breakSeconds: totalBreakSeconds,
  } = summarizeTimeline(timeline);
  const taskIds = new Set(
    timeLogs.map((timeLog) =>
      String(timeLog.task?._id || timeLog.task || "unassigned")
    )
  );

  const displayDate = /^\d{4}-\d{2}-\d{2}$/.test(reportDate || "")
    ? new Date(...reportDate.split("-").map((value, index) => Number(value) - (index === 1 ? 1 : 0)))
    : new Date();
  todayDate.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(displayDate);
  todayTotal.textContent = formatDuration(totalSeconds);
  todayBreak.textContent = formatDuration(totalBreakSeconds);
  todayIdle.textContent = formatDuration(totalIdleSeconds);
  todaySessions.textContent = String(timeLogs.length);
  todayTasks.textContent = String(taskIds.size);
  todayTimesheetBody.textContent = "";
  const view = getTimesheetView(timeLogs, {}, reportNow);
  todayTimesheetEmpty.hidden = view.timeline.length > 0;
  todayTimesheetEmpty.textContent = "No task time has been recorded today.";

  view.timeline.forEach(({ timeLog, entry }) => {
      const row = document.createElement("tr");
      row.className = `timesheet-timeline-row timesheet-${entry.type}-row`;
      appendTimelineTypeCell(row, entry, timeLog);
      appendSegmentCell(
        row,
        entry.type === "work"
          ? `${timeLog.task?.taskName || "Task"} · Work ${entry.sequence}`
          : entry.source === "between_sessions"
            ? "Idle between tasks"
            : `${entry.type === "break" ? "Break" : "Idle"} ${entry.sequence}`,
        entry.type === "work" ? timeLog.note : null
      );
      appendTimesheetCell(row, formatTime(entry.start));
      appendTimesheetCell(row, entry.end ? formatTime(entry.end) : "In progress");

      const disconnected = timeLog.stopReason === "desktop_disconnected"
        && entry.end?.getTime() === new Date(timeLog.stoppedAt).getTime();
      const status = entry.source === "between_sessions" ? "idle" : entry.open
        ? entry.type === "break" ? "break" : entry.type === "idle" ? "paused" : "running"
        : disconnected ? "disconnected" : "completed";
      const statusCell = document.createElement("td");
      const statusBadge = document.createElement("span");
      statusBadge.className = `timesheet-status timesheet-status-${status}`;
      statusBadge.textContent = entry.source === "between_sessions" ? "Idle" : entry.open
        ? entry.type === "break" ? "On break" : entry.type === "idle" ? "Idle" : "Running"
        : disconnected
          ? "Desktop connection lost"
          : timeLog.entrySource === "manual" ? "Manual entry" : "Completed";
      statusCell.appendChild(statusBadge);
      row.appendChild(statusCell);

      appendTimesheetCell(row, entry.type === "idle" ? formatDuration(entry.seconds) : "—");
      appendTimesheetCell(row, formatDuration(entry.seconds));
      todayTimesheetBody.appendChild(row);
  });
}

async function loadTodayTimesheet({ force = false } = {}) {
  const token = getToken();

  if (!token) {
    return;
  }

  timesheetMessage.textContent = "Loading today’s task time…";
  refreshTimesheetButton.disabled = true;

  try {
    // startDate/endDate keep this client compatible with servers deployed
    // before the company-timezone-aware `today=true` shortcut was added.
    const now = new Date();
    const localDateKey = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const { response, data, items: todaysTimeLogs, cancelled } = await fetchAllPages(
      `${API_BASE_URL}/time-logs/history?today=true&startDate=${localDateKey}&endDate=${localDateKey}`,
      "timeLogs",
      token,
      { reportSync: true, force }
    );

    if (cancelled) return;

    if (!response.ok) {
      timesheetMessage.textContent =
        data.message ||
        "Unable to load today’s timesheet.";

      return;
    }

    renderTodayTimesheet(todaysTimeLogs, data.date);
    timesheetMessage.textContent = "";
  } catch (error) {
    if (getToken() !== token) return;
    timesheetMessage.textContent =
      "Unable to reach the backend server.";
  } finally {
    refreshTimesheetButton.disabled = false;
  }
}
function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    hours,
    minutes,
    seconds,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function calculateCurrentWorkSeconds(timeLog, now = Date.now()) {
  const startedAt = validTimelineTime(timeLog?.startedAt);
  if (startedAt === null) return 0;

  const intentionalBreaks = (timeLog.pauses || [])
    .filter((pause) => ["break", "manual"].includes(pause.reason) && pause.pausedAt)
    .sort((first, second) =>
      new Date(first.pausedAt).getTime() - new Date(second.pausedAt).getTime()
    );
  const activeBreak = [...intentionalBreaks].reverse().find((pause) => !pause.resumedAt);
  const lastCompletedBreak = [...intentionalBreaks].reverse().find((pause) => pause.resumedAt);
  const segmentStart = lastCompletedBreak
    ? validTimelineTime(lastCompletedBreak.resumedAt)
    : startedAt;
  if (segmentStart === null) return 0;

  const openPause = [...(timeLog.pauses || [])]
    .reverse()
    .find((pause) => pause.pausedAt && !pause.resumedAt);
  const segmentEnd = activeBreak
    ? validTimelineTime(activeBreak.pausedAt)
    : openPause
      ? validTimelineTime(openPause.pausedAt)
      : now;
  const resolvedEnd = segmentEnd ?? now;
  const idleMilliseconds = (timeLog.pauses || []).reduce((total, pause) => {
    if (!isIdlePauseReason(pause.reason) || !pause.pausedAt) return total;
    const pauseStart = Math.max(segmentStart, validTimelineTime(pause.pausedAt) ?? resolvedEnd);
    const pauseEnd = Math.min(
      resolvedEnd,
      pause.resumedAt ? validTimelineTime(pause.resumedAt) ?? resolvedEnd : resolvedEnd
    );
    return total + Math.max(0, pauseEnd - pauseStart);
  }, 0);

  return Math.max(0, Math.floor((resolvedEnd - segmentStart - idleMilliseconds) / 1000));
}

function calculateBreakSeconds(timeLog) {
  // The whole session is break time when it's running on a break-typed
  // task - not just the time spent paused inside a work task.
  if (isBreakTask(timeLog)) return calculateCurrentWorkSeconds(timeLog);
  if (!isIntentionalBreak(timeLog)) return 0;
  const now = Date.now();
  const currentBreak = [...(timeLog?.pauses || [])]
    .reverse()
    .find((pause) => ["break", "manual"].includes(pause.reason) && pause.pausedAt && !pause.resumedAt);
  if (!currentBreak) return 0;
  return Math.max(0, Math.floor((now - new Date(currentBreak.pausedAt).getTime()) / 1000));
}

function updateBreakUI(timeLog = currentTimeLog) {
  const onBreak = isBreakTask(timeLog) || isIntentionalBreak(timeLog);
  const activeBreak = onBreak && ["running", "paused"].includes(timeLog?.status);
  if (stopBreakButton) {
    stopBreakButton.hidden = !activeBreak;
    stopBreakButton.disabled = !activeBreak || Boolean(timerAction) || logoutPending || appClosePending;
  }
  if (breakClock) breakClock.hidden = false;
  const currentBreakDuration = formatDuration(calculateBreakSeconds(timeLog));
  if (breakDuration) breakDuration.textContent = currentBreakDuration;
  if (timesheetBreakDuration) timesheetBreakDuration.textContent = currentBreakDuration;
  setClassState(timerStatus, "status-break", onBreak);
  setClassState(breakClock, "is-on-break", onBreak);
}

// Notes can be entered before starting a timer, and edited any time while
// it's running or paused - saveNote() PATCHes the edit to the active timer.
// Skip refreshing the value while the user is actively typing in it so a
// background poll can't clobber an in-progress edit.
function updateNoteControlsUI(timeLog = currentTimeLog) {
  if (timerNote && !noteDirty && document.activeElement !== timerNote) {
    timerNote.value = timeLog?.note || readNoteDraft();
  }
  if (noteSaveStatus && !timeLog && !noteDirty) {
    noteSaveStatus.textContent = readNoteDraft()
      ? "Draft saved. It will be attached when the timer starts."
      : "";
  }
}

async function saveNote() {
  if (!timerNote) return;
  if (saveNoteButton) {
    saveNoteButton.disabled = true;
    saveNoteButton.textContent = "Saving...";
  }
  try {
    if (!currentTimeLog) {
      saveNoteDraft(timerNote.value);
      noteDirty = !selectedTaskId;
      if (noteSaveStatus) noteSaveStatus.textContent = selectedTaskId
        ? "Draft saved. It will be attached when the timer starts."
        : "Select a task to save this note.";
      return;
    }

    const token = getToken();
    if (!token) {
      if (noteSaveStatus) noteSaveStatus.textContent = "Sign in again to save the note.";
      return;
    }

    const note = timerNote.value.trim();
    if (note === (currentTimeLog.note || "")) {
      noteDirty = false;
      if (noteSaveStatus) noteSaveStatus.textContent = "Note saved.";
      return;
    }

    if (noteSaveStatus) noteSaveStatus.textContent = "Saving note...";
    const response = await fetch(`${API_BASE_URL}/time-logs/note`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ note }),
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    });

    const data = await response.json();
    if (!response.ok || !data.timeLog) {
      throw new Error(data.message || "Unable to save note.");
    }
    currentTimeLog = data.timeLog;
    noteDirty = false;
    if (noteSaveStatus) noteSaveStatus.textContent = "Note saved.";
  } catch (error) {
    if (noteSaveStatus) noteSaveStatus.textContent = error.message || "Unable to save note. Try again.";
  } finally {
    if (saveNoteButton) {
      saveNoteButton.disabled = false;
      saveNoteButton.textContent = "Save note";
    }
  }
}

function stopLiveDuration() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startLiveDuration(timeLog) {
  stopLiveDuration();

  const updateDuration = () => {
    const workedSeconds =
      calculateCurrentWorkSeconds(timeLog);

    // A break-typed task never accrues "worked" time - its elapsed time is
    // shown under the break clock instead (see calculateBreakSeconds).
    timerDuration.textContent =
      formatDuration(isBreakTask(timeLog) ? 0 : workedSeconds);
    updateBreakUI(timeLog);
  };

  updateDuration();

  timerInterval = setInterval(
    updateDuration,
    1000
  );
}
async function loadActiveTimer() {
  const token = getToken();

  if (!token) {
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/time-logs/active`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      }
    );
    noteServerResponse(response);

    const data = await response.json();

    if (!response.ok) {
      timerMessage.textContent =
        data.message || "Unable to load active timer.";

      return;
    }

    timerStateConfirmed = true;
    stopLiveDuration();
    if (!data.timeLog) {
      currentTimeLog = null;
      pendingIdleStop = null;
      automaticIdlePause = false;
      activeTaskIdleLogout = false;
      // A completed/closed timer must never leave a hidden task ID that can
      // start new work while the dropdown visibly says "Select Task".
      setSelectedTaskId("", "loadActiveTimer: no active timer");
      if (selectedProjectId) await loadTasks(selectedProjectId);
      else if (taskSelect) taskSelect.value = "";
      timerStatus.textContent = "Not Started";
      timerDuration.textContent = "00:00:00";
      updateBreakUI(null);
      updateNoteControlsUI(null);

      startTimerButton.disabled = false;
      if (pauseTimerButton) pauseTimerButton.disabled = true;
      if (resumeTimerButton) resumeTimerButton.disabled = true;
      stopTimerButton.disabled = true;

      return;
    }

    const timeLog = data.timeLog;
    currentTimeLog = timeLog;
    activeTaskIdleLogout = timeLog.task?.idleLogout === true;
    // Restored timers require a manual Resume after authentication or app restart.
    automaticIdlePause = false;

    timerStatus.textContent =
      timeLog.status === "paused"
        ? getOpenPauseReason(timeLog) === "idle"
          ? "Idle"
          : "On Break"
        : runningStatusLabel(timeLog);
    updateBreakUI(timeLog);

    // Restore the running work from the backend record (the only place the
    // selection is taken from the server rather than from the employee).
    if (timeLog.project) {
      setSelectedProjectId(timeLog.project._id, "loadActiveTimer: restore active timer");
      setSelectedTaskId(timeLog.task?._id, "loadActiveTimer: restore active timer");
      ensureOption(projectSelect, timeLog.project._id, timeLog.project.projectName);
      projectSelect.value = selectedProjectId;
      selectedClientId = String(timeLog.client?._id || timeLog.client || "");
      updateClientName();

      await loadTasks(timeLog.project._id);
    }

    if (timeLog.task) {
      ensureOption(taskSelect, timeLog.task._id, timeLog.task.taskName);
      taskSelect.value = timeLog.task._id;
    }

    projectSelect.disabled = true;
    if (clientSelect) clientSelect.disabled = true;
    taskSelect.disabled = true;
    updateNoteControlsUI(timeLog);

    startTimerButton.disabled = true;

    if (timeLog.status === "running") {
      if (pauseTimerButton) pauseTimerButton.disabled = false;
      if (resumeTimerButton) resumeTimerButton.disabled = true;

      startLiveDuration(timeLog);
    } else {
      if (pauseTimerButton) pauseTimerButton.disabled = getOpenPauseReason(timeLog) === "idle";

      const workedSeconds =
        calculateCurrentWorkSeconds(timeLog);

      timerDuration.textContent =
        formatDuration(workedSeconds);
      if (isIntentionalBreak(timeLog)) startLiveDuration(timeLog);
    }

    stopTimerButton.disabled = false;
  } catch (error) {
    serverReachable = false;
    timerMessage.textContent =
      "Unable to load active timer.";
  } finally {
    syncTimerLock();
  }
}
async function stopTimer({ idleSeconds = 0 } = {}) {
  if (pendingIdleStop) idleSeconds = Math.max(idleSeconds, Math.floor((Date.now() - pendingIdleStop.startedAt) / 1000));
  const token = getToken();

  timerMessage.textContent = "";

  if (!token) {
    timerMessage.textContent = "You must be logged in.";
    return;
  }

  // Name the timer this click means, so a late retry can never stop a timer
  // started afterwards.
  const stopTarget = currentTimeLog?._id ? String(currentTimeLog._id) : undefined;
  if (!pendingStopOperation || pendingStopOperation.timeLogId !== stopTarget) {
    pendingStopOperation = { timeLogId: stopTarget, id: newOperationId() };
  }

  try {
    stopTimerButton.disabled = true;
    if (stopBreakButton) stopBreakButton.disabled = true;

    const response = await fetch(
      `${API_BASE_URL}/time-logs/stop`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...(idleSeconds > 0 ? { idleSeconds: Math.floor(idleSeconds) } : {}),
          operationId: pendingStopOperation.id,
          ...(stopTarget ? { timeLogId: stopTarget } : {}),
        }),
        signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      }
    );
    noteServerResponse(response);

    const data = await response.json();
    if (response.status < 500) pendingStopOperation = null;

    if (!response.ok) {
      if (response.status === 404 || data.code === "TIMER_CHANGED") {
        // A disconnected desktop timer may have been closed by the server
        // between the last refresh and this click, or another timer is now
        // running. Reconcile the controls.
        await loadActiveTimer();
        await loadTodayTimesheet();
        timerMessage.textContent = data.code === "TIMER_CHANGED"
          ? "A different timer is running now. Your timer has been refreshed."
          : "The timer was already stopped. Your timesheet has been refreshed.";
        return;
      }
      timerMessage.textContent =
        data.message || "Unable to stop timer.";

      stopTimerButton.disabled = false;
      updateBreakUI();
      return;
    }

    stopLiveDuration();

    currentTimeLog = null;
    timerStateConfirmed = true;
    automaticIdlePause = false;
    activeTaskIdleLogout = false;
    pendingIdleStop = null;
    if (idleSeconds <= 0) {
      setSelectedTaskId("", "timer stopped");
      taskSelect.value = "";
    }
    timerStatus.textContent = idleSeconds > 0 ? "Idle" : "Stopped";
    updateBreakUI(null);
    updateNoteControlsUI(null);

    // This is the live-session clock, not the completed-session summary.
    // The saved duration is shown in the timesheet instead.
    timerDuration.textContent = "00:00:00";

    timerMessage.textContent = idleSeconds > 0
      ? "Your timer stopped due to inactivity. Click Continue, then Start to work again."
      : data.message || "Timer stopped successfully.";

    startTimerButton.disabled = false;
    if (pauseTimerButton) pauseTimerButton.disabled = true;
    if (resumeTimerButton) resumeTimerButton.disabled = true;
    stopTimerButton.disabled = true;

    projectSelect.disabled = false;
    if (clientSelect) clientSelect.disabled = !clientSelect.options || clientSelect.options.length <= 1;

    // Only re-enable the task dropdown when it holds real task options.
    taskSelect.disabled =
      !selectedProjectId || tasksSignature === null;
    // Announce only the confirmed Working -> Idle transition. Acknowledging
    // this notice never changes the timer or its saved idle interval.
    if (idleSeconds > 0) showIdleStartedPopup(data.timeLog, idleSeconds);
    void loadTodayTimesheet();
  } catch (error) {
    serverReachable = false;
    timerMessage.textContent =
      "Unable to reach the backend server.";

    stopTimerButton.disabled = false;
    updateBreakUI();
  }
}
async function pauseTimer(reason = "manual") {
  const token = getToken();

  timerMessage.textContent = "";

  if (!token) {
    timerMessage.textContent = "You must be logged in.";
    return;
  }

  try {
    if (pauseTimerButton) pauseTimerButton.disabled = true;

    const response = await fetch(
      `${API_BASE_URL}/time-logs/pause`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
        signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      timerMessage.textContent =
        data.message || "Unable to pause timer.";

      if (pauseTimerButton) pauseTimerButton.disabled = false;
      return;
    }

    if (data.skipped) {
      if (pauseTimerButton) pauseTimerButton.disabled = false;
      return;
    }

    stopLiveDuration();

    currentTimeLog = data.timeLog;
    automaticIdlePause = reason === "idle";

    const workedSeconds =
      calculateCurrentWorkSeconds(data.timeLog);

    timerDuration.textContent =
      formatDuration(workedSeconds);

    timerStatus.textContent = reason === "idle" ? "Idle" : "On Break";
    updateBreakUI(data.timeLog);
    updateNoteControlsUI(data.timeLog);
    if (reason === "break") startLiveDuration(data.timeLog);

    timerMessage.textContent =
      reason === "break" ? "Break started successfully." : data.message || "Timer paused successfully.";

    startTimerButton.disabled = true;
    if (pauseTimerButton) pauseTimerButton.disabled = reason === "idle";
    stopTimerButton.disabled = false;

    projectSelect.disabled = true;
    taskSelect.disabled = true;
  } catch (error) {
    timerMessage.textContent =
      "Unable to reach the backend server.";

    if (pauseTimerButton) pauseTimerButton.disabled = false;
  }
}
async function resumeTimer(reason = "manual") {
  const token = getToken();

  timerMessage.textContent = "";

  if (!token) {
    timerMessage.textContent = "You must be logged in.";
    return;
  }

  try {
    if (pauseTimerButton) pauseTimerButton.disabled = true;

    const response = await fetch(
      `${API_BASE_URL}/time-logs/resume`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
        signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      if (reason === "idle" && response.status === 404) {
        automaticIdlePause = false;
        return;
      }

      timerMessage.textContent =
        data.message || "Unable to resume timer.";

      if (pauseTimerButton) pauseTimerButton.disabled = false;
      return;
    }

    stopLiveDuration();
    currentTimeLog = data.timeLog;
    automaticIdlePause = false;
    timerStatus.textContent = runningStatusLabel(data.timeLog);
    updateBreakUI(data.timeLog);
    updateNoteControlsUI(data.timeLog);

    timerMessage.textContent =
      reason === "break" ? "Break ended successfully." : data.message || "Timer resumed successfully.";

    startTimerButton.disabled = true;
    if (pauseTimerButton) pauseTimerButton.disabled = false;
    if (resumeTimerButton) resumeTimerButton.disabled = true;
    stopTimerButton.disabled = false;

    projectSelect.disabled = true;
    taskSelect.disabled = true;

    startLiveDuration(data.timeLog);
    if (reason === "break") void loadTodayTimesheet();
  } catch (error) {
    timerMessage.textContent =
      "Unable to reach the backend server.";

    if (pauseTimerButton) pauseTimerButton.disabled = false;
  }
}
async function startTimer() {
  const token = getToken();

  // The visible controls are authoritative. Local storage may contain the
  // previous task while the task list is still loading (or after a restart),
  // and using that hidden value would silently restart work on the old task.
  const projectId = String(projectSelect?.value || "");
  const taskId = String(taskSelect?.value || "");
  const clientId = String(clientSelect?.value || "");

  if (projectId !== selectedProjectId) {
    setSelectedProjectId(projectId, "startTimer: sync visible project");
  }
  if (taskId !== selectedTaskId) {
    setSelectedTaskId(taskId, "startTimer: sync visible task");
  }

  timerMessage.textContent = "";

  if (!token) {
    timerMessage.textContent =
      "You must be logged in.";

    return;
  }

  if (!projectId || !taskId) {
    timerMessage.textContent =
      "Please select a project and task first.";

    return;
  }

  if (clientSelect && !clientsLoaded) {
    timerMessage.textContent = clientLoadFailed
      ? "Unable to load clients. Please try again."
      : "Clients are still loading. Please try again.";
    return;
  }

  if (clientSelect && clientSelect.options.length > 1 && !clientId) {
    timerMessage.textContent = "Please select a client first.";
    return;
  }

  // Retrying the same selection after a lost response reuses its ID.
  const startKey = `${projectId}|${taskId}|${clientId}`;
  if (!pendingStartOperation || pendingStartOperation.key !== startKey) {
    pendingStartOperation = { key: startKey, id: newOperationId() };
  }

  const previousStatus = timerStatus.textContent;
  const pendingStart = Date.now();
  const isStartingBreak = taskSelect.selectedOptions[0]?.dataset.taskType === "break";
  let pendingInterval = null;
  try {
    startTimerButton.disabled = true;
    timerStatus.textContent = "Starting...";
    timerMessage.textContent = "Starting timer...";
    if (!isStartingBreak) {
      timerDuration.textContent = "00:00:00";
      pendingInterval = setInterval(() => {
        timerDuration.textContent = formatDuration(Math.floor((Date.now() - pendingStart) / 1000));
      }, 250);
    }

    timerStartInFlight = true;
    syncTimerLock();
    const response = await fetch(
      `${API_BASE_URL}/time-logs/start`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
          project: projectId,
          client: clientId || undefined,
          task: taskId,
          note: readNoteDraft().trim() || undefined,
          clientType: "desktop",
          operationId: pendingStartOperation.id,
        }),
        signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      }
    );
    noteServerResponse(response);

    const data = await response.json();
    if (response.status < 500) pendingStartOperation = null;

    if (!response.ok) {
      if (data.code === "ACTIVE_TIMER_EXISTS") {
        // Usually an earlier start whose response was lost. Show the timer
        // the server is running instead of an error.
        await loadActiveTimer();
        await loadTodayTimesheet();
        timerMessage.textContent = "A timer was already running. It is shown again.";
        return;
      }
      timerMessage.textContent =
        data.message ||
        "Unable to start timer.";

      startTimerButton.disabled = false;

      return;
    }

    if (data.replayed && !["running", "paused"].includes(data.timeLog?.status)) {
      // The earlier start went through and has been stopped since.
      await loadActiveTimer();
      await loadTodayTimesheet();
      timerMessage.textContent = "That timer was already started and stopped. Your timesheet has been refreshed.";
      return;
    }

    timerStatus.textContent = runningStatusLabel(data.timeLog);

    currentTimeLog = data.timeLog;
    timerStateConfirmed = true;
    clearNoteDraft();
    activeTaskIdleLogout = data.timeLog.task?.idleLogout === true
      || taskSelect.selectedOptions[0]?.dataset.idleLogout === "true";
    automaticIdlePause = false;
    updateBreakUI(data.timeLog);
    updateNoteControlsUI(data.timeLog);
    startLiveDuration(data.timeLog);

    timerMessage.textContent =
      data.message ||
      "Timer started successfully.";

    startTimerButton.disabled = true;
    if (pauseTimerButton) pauseTimerButton.disabled = false;
    if (resumeTimerButton) resumeTimerButton.disabled = true;
    stopTimerButton.disabled = false;

    projectSelect.disabled = true;
    if (clientSelect) clientSelect.disabled = true;
    taskSelect.disabled = true;
  } catch (error) {
    serverReachable = false;
    timerMessage.textContent =
      "Unable to reach the backend server.";

    startTimerButton.disabled = false;
  } finally {
    // runTimerAction re-reports the lock from the confirmed state.
    timerStartInFlight = false;
    if (pendingInterval !== null) clearInterval(pendingInterval);
    if (!currentTimeLog) {
      timerStatus.textContent = previousStatus;
      timerDuration.textContent = "00:00:00";
    }
  }
}

projectSelect?.addEventListener(
  "change",
  async () => {
    // Keep the new project; only the previous project's task is cleared.
    setSelectedProjectId(projectSelect.value, "employee changed project");
    setSelectedTaskId("", "employee changed project");
    updateClientName();

    await Promise.all([loadClients(), loadTasks(selectedProjectId)]);
  }
);

clientSelect?.addEventListener("change", () => {
  selectedClientId = String(clientSelect.value || "");
  saveWorkSelection();
});

taskSelect?.addEventListener("change", () => {
  setSelectedTaskId(taskSelect.value, "employee changed task");
});

window.addEventListener("focus", refreshDesktopData);
window.addEventListener("online", refreshDesktopData);
window.addEventListener("offline", () => {
  serverReachable = false;
  syncTimerLock();
});
// After sleep the server may have closed the timer for missed heartbeats.
window.electronAPI?.onSystemResume?.(() => {
  if (isLoginPage || !getToken() || logoutPending || timerAction) return;
  void loadActiveTimer();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshDesktopData();
});

loginForm?.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    if (loginInProgress) {
      console.debug("[desktop-login] Duplicate submit ignored");
      return;
    }

    loginInProgress = true;

    const email = String(loginForm.elements.email?.value || "").trim();
    const password = String(loginForm.elements.password?.value || "");
    console.debug(`[desktop-login] Button clicked; email present: ${Boolean(email)}; password present: ${Boolean(password)}; API URL: ${API_BASE_URL}/auth/login`);

    message.textContent = "";
    message.classList.remove("approval-pending");

    const rememberedSessionToken = localStorage.getItem("rememberedSessionToken");
    const useRememberedSession = !email && !password && rememberedSessionToken;
    if ((!email || !password) && !useRememberedSession) {
      message.textContent =
        "Email and password are required.";
      loginInProgress = false;
      return;
    }

    try {
      loginButton.disabled = true;
      loginButton.textContent = "Logging in...";
      console.debug("[desktop-login] Request started");

      const response = await fetch(
        `${API_BASE_URL}${useRememberedSession ? "/auth/quick-login" : "/auth/login"}`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify(useRememberedSession
            ? { rememberedSessionToken, ...DEVICE_INFO }
            : { email, password, ...DEVICE_INFO }),
          signal: AbortSignal.timeout(15000),
        }
      );

      let data = await response.json();
      console.debug(`[desktop-auth] Login response: ${response.status} ${response.url}`);

      if (response.status === 409 && data.code === "DEVICE_APPROVAL_REQUIRED") {
        data = await waitForDeviceApproval(data.loginRequest);
        if (!data) return;
      } else if (!response.ok) {
        if (useRememberedSession && [401, 403].includes(response.status)) {
          localStorage.removeItem("rememberedSessionToken");
          localStorage.removeItem("rememberedUser");
          if (rememberedLogin) rememberedLogin.hidden = true;
          if (loginForm) loginForm.hidden = false;
        }
        message.textContent = useRememberedSession
          ? "Your remembered session has expired. Enter your email and password."
          : response.status === 401
            ? "Invalid email or password."
            : response.status === 403
              ? "Your account is inactive or not permitted to use CRM."
              : response.status >= 500
                ? "Server error. Please try again later."
                : data.message || "Login failed.";

        return;
      }

      if (!data.token || !data.user) {
        throw new Error("Login response did not contain the expected session data");
      }

      localStorage.setItem(
        "token",
        data.token
      );

      localStorage.setItem(
        "user",
        JSON.stringify(data.user)
      );
      console.debug(`[desktop-login] Authentication success; role: ${data.user?.role || "unknown"}`);
      console.debug("[desktop-login] Token stored: yes; user stored: yes");

      if (data.rememberedSessionToken) {
        localStorage.setItem("rememberedSessionToken", data.rememberedSessionToken);
        localStorage.setItem("rememberedUser", JSON.stringify(data.user));
      }

      console.debug("[desktop-login] Navigating to: ./dashboard.html");
      window.location.replace("./dashboard.html");
    } catch (error) {
      message.classList.remove("approval-pending");
      console.error(`[desktop-auth] Login failed for ${API_BASE_URL}/auth/login:`, error.name, error.message);
      message.textContent = error.name === "TimeoutError"
        ? "The server is taking too long to respond. Please try again."
        : "Unable to reach the backend server. Please check your internet connection and try again.";
    } finally {
      loginInProgress = false;
      loginButton.disabled = false;
      loginButton.textContent = "Login";
    }
  }
);

refreshTimesheetButton?.addEventListener(
  "click",
  () => loadTodayTimesheet({ force: true })
);

quickLoginButton?.addEventListener("click", () => {
  emailInput.value = "";
  passwordInput.value = "";
  loginForm.requestSubmit();
});

differentAccountButton?.addEventListener("click", () => {
  localStorage.removeItem("rememberedSessionToken");
  localStorage.removeItem("rememberedUser");
  rememberedLogin.hidden = true;
  loginForm.hidden = false;
  message.textContent = "";
  emailInput.focus();
});

startTimerButton?.addEventListener(
  "click",
  () => runTimerAction(startTimer)
);
stopTimerButton?.addEventListener(
  "click",
  () => runTimerAction(stopTimer)
);
stopBreakButton?.addEventListener("click", () => {
  if (["running", "paused"].includes(currentTimeLog?.status)
    && (isBreakTask() || isIntentionalBreak())) {
    return runTimerAction(stopTimer);
  }
});
logoutButton?.addEventListener("click", () => signOut(false));
acknowledgeIdleButton?.addEventListener("click", (event) => {
  if (event && !event.isTrusted) return;
  idleAcknowledgedAt = Date.now();
  clearIdleNoticeDisplay();
  idleStartedDialog.close();
  if (timerMessage) timerMessage.textContent = "Idle time was saved separately. Press Start to continue the selected task.";
});
idleStartedDialog?.addEventListener("cancel", (event) => event.preventDefault());
idleStartedDialog?.addEventListener("close", clearIdleNoticeDisplay);
keepThisDeviceButton?.addEventListener("click", () => decideDeviceLogin("deny"));
allowNewDeviceButton?.addEventListener("click", () => decideDeviceLogin("allow"));

async function initializeApp() {
  const storedUser = getStoredUser();
  const token = getToken();
  if (isLoginPage && sessionStorage.getItem("inactivityLogout")) {
    const logoutMinutes = Number(sessionStorage.getItem("inactivityLogoutMinutes"));
    message.textContent = Number.isFinite(logoutMinutes) && logoutMinutes > 0
      ? `You were logged out after ${logoutMinutes} minute${logoutMinutes === 1 ? "" : "s"} of inactivity.`
      : "You were logged out after a period of inactivity.";
    sessionStorage.removeItem("inactivityLogout");
    sessionStorage.removeItem("inactivityLogoutMinutes");
  }
  if (isLoginPage && sessionStorage.getItem("sessionEndedMessage")) {
    message.textContent = sessionStorage.getItem("sessionEndedMessage");
    sessionStorage.removeItem("sessionEndedMessage");
  }

  if (isLoginPage && !token && localStorage.getItem("rememberedSessionToken")) {
    const rememberedUser = getRememberedUser();
    if (rememberedLogin && rememberedUser) {
      const rememberedDisplayName = rememberedUser.fullName || rememberedUser.name || "Employee";
      rememberedName.textContent = rememberedDisplayName;
      rememberedEmail.textContent = rememberedUser.email || "Remembered CRM account";
      rememberedAvatar.textContent = rememberedDisplayName.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
      rememberedLogin.hidden = false;
      loginForm.hidden = true;
    } else {
      message.textContent = "Click Login to continue with the remembered session.";
    }
  }

  if (isLoginPage && storedUser && token) {
    window.location.replace("./dashboard.html");
    return;
  }

  if (!isLoginPage && (!storedUser || !token)) {
    window.location.replace("./index.html");
    return;
  }

  if (storedUser && token) {
    try {
      const response = await fetch(API_BASE_URL + "/auth/me", {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.location.replace("./index.html");
        return;
      }
      if (!response.ok) throw new Error("Session unavailable");
    } catch {
      // Monitoring still starts with safe defaults while connectivity recovers.
      timerMessage.textContent = "CRM could not refresh your session. Please check your connection.";
    }
    restoreWorkSelection();
    showLoggedInView(storedUser);

    await loadIdlePolicy();
    startIdleMonitor();
    startTimerHeartbeat();
    void monitorDeviceLoginRequests();
    await loadClients();
    if (logoutPending || !getToken()) return;
    await loadProjects();
    if (logoutPending || !getToken()) return;
    await loadActiveTimer();
    if (logoutPending || !getToken()) return;
    await loadTodayTimesheet();
    if (logoutPending || !getToken()) return;

    idlePolicyRefreshInterval = setInterval(async () => {
      await loadIdlePolicy();
      startIdleMonitor();
    }, 60 * 1000);
    dataRefreshInterval = setInterval(refreshDesktopData, DATA_REFRESH_INTERVAL_MS);
  } else {
    showLoggedOutView();
  }
}

initializeApp();
