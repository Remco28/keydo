export function resolveCaptureProject(name, projectsById, fallbackProjectNames = []) {
  const normalizedName = name.toLowerCase();
  const matches = [...projectsById.values()].filter(project => project.name.toLowerCase() === normalizedName);
  if (matches.length === 1) return { name: matches[0].name, id: matches[0].id };
  if (matches.length > 1) return null;
  const fallbackMatches = fallbackProjectNames.filter(projectName => projectName.toLowerCase() === normalizedName);
  if (fallbackMatches.length === 1) return { name: fallbackMatches[0] };
  if (fallbackMatches.length > 1) return null;
  return normalizedName === "inbox" ? { name: "Inbox" } : null;
}

export function canCaptureInWorkspace(workspace, liveTodoist) {
  return !liveTodoist || workspace === "Personal";
}

export function parseCapture(value, projectNames = []) {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const removed = new Set();
  const projectIndex = tokens.findIndex(token => token.startsWith("#"));
  let project = "Inbox";
  if (projectIndex >= 0) {
    const projectWords = [tokens[projectIndex].slice(1)];
    for (let index = projectIndex + 1; index < tokens.length; index += 1) {
      if (tokens[index].startsWith("#") || /^(?:today|tomorrow|p[1-4])$/i.test(tokens[index])) break;
      projectWords.push(tokens[index]);
    }
    const normalizedNames = new Map(projectNames.map(name => [name.toLowerCase(), name]));
    for (let length = projectWords.length; length > 0; length -= 1) {
      const name = projectWords.slice(0, length).join(" ");
      const canonicalName = normalizedNames.get(name.toLowerCase());
      if (!canonicalName) continue;
      project = canonicalName;
      for (let index = projectIndex; index < projectIndex + length; index += 1) removed.add(index);
      break;
    }
    if (!removed.has(projectIndex)) {
      project = tokens[projectIndex].length > 1 ? tokens[projectIndex].slice(1) : "Inbox";
      removed.add(projectIndex);
    }
  }

  const priorityIndex = tokens.findIndex(token => /^p[1-4]$/i.test(token));
  const dueIndex = tokens.findIndex(token => /^(today|tomorrow)$/i.test(token));
  const priorityToken = priorityIndex >= 0 ? tokens[priorityIndex] : null;
  const dueToken = dueIndex >= 0 ? tokens[dueIndex] : null;
  if (priorityIndex >= 0) removed.add(priorityIndex);
  if (dueIndex >= 0) removed.add(dueIndex);
  const priority = priorityToken ? ({ p1: 4, p2: 3, p3: 2, p4: 1 }[priorityToken.toLowerCase()]) : 1;
  const due = dueToken ? dueToken.charAt(0).toUpperCase() + dueToken.slice(1).toLowerCase() : "Today";
  const title = tokens.filter((_, index) => !removed.has(index)).join(" ");
  return { title, project, priority, due };
}

export function appendCreatedTask(tasks, task) {
  return [...tasks.filter(item => item !== task), task];
}

export function mergeResolvedCreatedTask(tasks, pendingTask, syncedTask) {
  const createPromise = pendingTask.keydoCreatePromise;
  const localAttachment = pendingTask.attachment;
  Object.assign(pendingTask, syncedTask);
  pendingTask.keydoCreatePromise = createPromise;
  if (localAttachment) pendingTask.attachment = localAttachment;
  return [...tasks.filter(task => task !== pendingTask && task !== syncedTask), pendingTask];
}

export function isDefinitiveCreateRejection(responseStatus, payload) {
  const status = createFailureStatus(responseStatus, payload);
  // A timeout can be generated after the command reached Todoist or an
  // intermediary, so it is not safe to tell the user the task was rejected
  // or let a retry create a new command UUID.
  return status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}

function createFailureStatus(responseStatus, payload) {
  if (responseStatus === 502 && Number.isInteger(payload?.status)) return payload.status;
  if (payload?.command_rejected && Number.isInteger(payload?.details?.http_code)) return payload.details.http_code;
  return responseStatus;
}

export function isCreateRateLimited(responseStatus, payload) {
  return isTodoistRateLimited(responseStatus, payload);
}

export function shouldRestoreCaptureAfterCreateFailure({ requestAttempted, definitelyRejected, rateLimited }) {
  return !requestAttempted || Boolean(definitelyRejected || rateLimited);
}

export function isTodoistRateLimited(responseStatus, payload) {
  if (createFailureStatus(responseStatus, payload) === 429) return true;
  if (!payload?.command_rejected) return false;
  const results = Array.isArray(payload.details)
    ? payload.details.map(entry => entry?.result)
    : [payload.details];
  return results.some(result => result && typeof result === "object" && result.http_code === 429);
}

export function todoistRetryAfterSeconds(payload) {
  let detail = null;
  if (payload?.status === 429 || payload?.details?.http_code === 429) {
    detail = payload.details;
  } else if (Array.isArray(payload?.details)) {
    detail = payload.details
      .map(entry => entry?.result)
      .find(result => result && typeof result === "object" && result.http_code === 429) ?? null;
  }
  const value = detail?.error_extra?.retry_after;
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}
