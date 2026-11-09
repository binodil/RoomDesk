import { availableMonitors, primaryMonitor } from "@tauri-apps/api/window";

// Step 1: prove the app works and show which monitors Tauri can see.
// Multi-monitor support is built in from the start, so this list matters for step 2.
async function showMonitors(): Promise<void> {
  const body = document.getElementById("monitors");
  if (!body) return;

  try {
    const [monitors, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
    if (monitors.length === 0) {
      body.innerHTML = `<tr><td colspan="5">No monitors reported.</td></tr>`;
      return;
    }

    body.innerHTML = "";
    monitors.forEach((m, i) => {
      const isPrimary = primary !== null && primary.name === m.name;
      const row = document.createElement("tr");
      const cells = [
        String(i + 1),
        (m.name ?? "Unknown") + (isPrimary ? " (main)" : ""),
        `${m.size.width} × ${m.size.height}`,
        `${Math.round(m.scaleFactor * 100)}%`,
        `${m.position.x}, ${m.position.y}`,
      ];
      for (const text of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        row.appendChild(td);
      }
      body.appendChild(row);
    });
  } catch (err) {
    body.innerHTML = "";
    const row = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = `Could not read monitors: ${String(err)}`;
    row.appendChild(td);
    body.appendChild(row);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  void showMonitors();
});
