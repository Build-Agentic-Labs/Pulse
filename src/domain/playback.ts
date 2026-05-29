import { getTaskWindow } from "./calculations";
import type { Task } from "./types";

/**
 * Builds the recent-events feed shown by the playback panel: the most recent
 * task start/finish events up to the current playback minute. Pure.
 */
export function buildPlaybackEvents(tasks: Task[], timelineStartMs: number, currentMinute: number) {
  const events = [
    { time: 0, label: "Product build started" },
    ...tasks.flatMap((task) => {
      const window = getTaskWindow(task, timelineStartMs);
      return [
        { time: window.startMinute, label: `${task.name} started`, taskId: task.id },
        { time: window.finishMinute, label: `${task.name} complete`, taskId: task.id },
      ];
    }),
  ];

  return events
    .filter((event) => event.time <= currentMinute + 0.25)
    .sort((a, b) => b.time - a.time)
    .slice(0, 8);
}
