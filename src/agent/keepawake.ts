import { spawn, type ChildProcess } from "node:child_process";

// ES_CONTINUOUS | ES_SYSTEM_REQUIRED: keeps the PC from sleeping while the helper process lives; the display may still turn off.
const SCRIPT = `
$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$k = Add-Type -MemberDefinition $sig -Name Power -Namespace Relay -PassThru
[void]$k::SetThreadExecutionState([uint32]"0x80000001")
while ($true) { Start-Sleep -Seconds 60 }
`;

export class KeepAwake {
  private proc: ChildProcess | null = null;

  get active() {
    return this.proc !== null;
  }

  set(on: boolean) {
    if (process.platform !== "win32") return;
    if (on && !this.proc) {
      this.proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT], { stdio: "ignore", windowsHide: true });
      this.proc.on("exit", () => (this.proc = null));
      this.proc.on("error", (err) => {
        console.error(`[relay] keep-awake failed: ${err.message}`);
        this.proc = null;
      });
    } else if (!on && this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}
