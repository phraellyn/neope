export function timerElapsed(timer, now = Date.now()) {
  return Math.max(0, Number(timer?.elapsedMs) || 0) + (timer?.runningSince ? Math.max(0, now - timer.runningSince) : 0)
}

export function pauseTimer(timer, now = Date.now()) {
  return { ...timer, elapsedMs: timerElapsed(timer, now), runningSince: null }
}

export function resumeTimer(timer, now = Date.now()) {
  return timer.runningSince ? timer : { ...timer, runningSince: now }
}

export function resetTimer(timer, now = Date.now()) {
  return { ...timer, elapsedMs: 0, runningSince: timer.runningSince ? now : null, alerted: false }
}

export function timerWarning(timer, durationMs, now = Date.now()) {
  return !timer.alerted && timerElapsed(timer, now) >= durationMs
}
