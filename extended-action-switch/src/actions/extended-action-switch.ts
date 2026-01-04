import { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";

/**
 * The Extended Action Switch allows for two-state toggling on short press
 * and a third override action tree on a 1-second hold.
 */
@action({ UUID: "com.xarishark.extended-action-switch.action" })
export class ExtendedActionSwitch extends SingletonAction<SwitchSettings> {
    private pressTimer: NodeJS.Timeout | null = null;
    private isLongPress = false;
    private initialState: number = 0;

    /**
     * Triggered when the key is pressed down. Starts a 1-second timer for long press.
     */
    override onKeyDown(ev: KeyDownEvent<SwitchSettings>): void | Promise<void> {
        this.isLongPress = false;
        this.initialState = ev.payload.state ?? 0;
        this.pressTimer = setTimeout(async () => {
            this.isLongPress = true;
            await this.executeHold(ev);
        }, 1000);
    }

    /**
     * Triggered when the key is released. Detects if it was a short press.
     */
    override async onKeyUp(ev: KeyUpEvent<SwitchSettings>): Promise<void> {
        if (this.pressTimer) {
            clearTimeout(this.pressTimer);
            this.pressTimer = null;
        }

        if (this.isLongPress) {
            // Restore initial state in case the Stream Deck software auto-toggled it
            await ev.action.setState(this.initialState);
        } else {
            await this.executeToggle(ev);
        }
    }

    /**
     * Handles messages sent from the Property Inspector.
     */
    override async onSendToPlugin(ev: any): Promise<void> {
        if (ev.payload.event === "browseFile") {
            const filePath = await this.browseFile();
            await ev.action.sendToPropertyInspector({
                event: "filePicked",
                payload: {
                    filePath,
                    index: ev.payload.index,
                    tree: ev.payload.tree
                }
            });
        }
    }

    /**
     * Opens a native file dialog using PowerShell (Windows) or AppleScript (macOS).
     */
    private async browseFile(): Promise<string> {
        const { exec } = await import("child_process");
        const isWin = process.platform === "win32";
        const cmd = isWin
            ? `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'All Files (*.*)|*.*'; if($f.ShowDialog() -eq 'OK') { $f.FileName }"`
            : `osascript -e 'POSIX path of (choose file)'`;

        return new Promise((resolve) => {
            exec(cmd, (err, stdout) => {
                if (err) {
                    // It often errors if user cancels, so just resolve empty
                    resolve("");
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    /**
     * Executes the hold override action tree.
     */
    private async executeHold(ev: KeyDownEvent<SwitchSettings>): Promise<void> {
        const { treeHold } = ev.payload.settings;
        if (treeHold && treeHold.length > 0) {
            await this.runActionTree(treeHold);
        }
    }

    /**
     * Executes the toggle logic (short press).
     */
    private async executeToggle(ev: KeyUpEvent<SwitchSettings>): Promise<void> {
        const { settings } = ev.payload;
        const currentState = ev.payload.state ?? 0;
        const nextState = currentState === 0 ? 1 : 0;

        // Execute the corresponding tree
        const treeToRun = currentState === 0 ? settings.tree0 : settings.tree1;
        if (treeToRun && treeToRun.length > 0) {
            await this.runActionTree(treeToRun);
        }

        // Update to next state
        await ev.action.setState(nextState);
    }

    /**
     * Runs a list of commands in sequence.
     */
    private async runActionTree(tree: ActionTree): Promise<void> {
        for (const cmd of tree) {
            try {
                switch (cmd.type) {
                    case "hotkey":
                        await this.simulateHotkey(cmd.value);
                        break;
                    case "url":
                        await open(cmd.value);
                        break;
                    case "text":
                        await this.simulateTyping(cmd.value);
                        break;
                    case "delay":
                        const ms = parseInt(cmd.value, 10);
                        if (!isNaN(ms)) await new Promise(res => setTimeout(res, ms));
                        break;
                    case "run":
                        await open(cmd.value);
                        break;
                }
            } catch (err) {
                console.error(`Failed to execute command ${cmd.type}:`, err);
            }
        }
    }

    /**
     * Simulates a hotkey. Supports Windows (SendKeys) and macOS (AppleScript).
     */
    private async simulateHotkey(keys: string): Promise<void> {
        const { exec } = await import("child_process");
        const isWin = process.platform === "win32";

        if (isWin) {
            const psCommand = `add-type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')`;
            return new Promise((resolve) => {
                exec(`powershell -Command "${psCommand}"`, () => resolve());
            });
        } else {
            // Simplified macOS mapping: ^ -> control, + -> shift, % -> command
            let modifiers: string[] = [];
            let key = keys;
            if (key.includes("^")) { modifiers.push("control down"); key = key.replace("^", ""); }
            if (key.includes("+")) { modifiers.push("shift down"); key = key.replace("+", ""); }
            if (key.includes("%")) { modifiers.push("command down"); key = key.replace("%", ""); }

            // Handle special keys wrapped in {}
            key = key.replace(/{|}/g, "");

            const modStr = modifiers.length > 0 ? ` using {${modifiers.join(", ")}}` : "";
            const appleScript = `tell application "System Events" to keystroke "${key.toLowerCase()}"${modStr}`;
            return new Promise((resolve) => {
                exec(`osascript -e '${appleScript}'`, () => resolve());
            });
        }
    }

    /**
     * Simulates typing text.
     */
    private async simulateTyping(text: string): Promise<void> {
        const { exec } = await import("child_process");
        const isWin = process.platform === "win32";

        if (isWin) {
            const psCommand = `add-type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')`;
            return new Promise((resolve) => {
                exec(`powershell -Command "${psCommand}"`, () => resolve());
            });
        } else {
            const appleScript = `tell application "System Events" to keystroke "${text.replace(/"/g, '\\"')}"`;
            return new Promise((resolve) => {
                exec(`osascript -e '${appleScript}'`, () => resolve());
            });
        }
    }
}

/**
 * Simple helper to open URL or App
 */
async function open(target: string) {
    const { exec } = await import("child_process");
    const isWin = process.platform === "win32";
    const start = isWin ? "start" : "open";
    const cmd = isWin ? `start "" "${target}"` : `${start} "${target}"`;
    return new Promise((resolve) => {
        exec(cmd, (err) => {
            if (err) console.error("Open failed:", err);
            resolve();
        });
    });
}


type Command = {
    type: "hotkey" | "url" | "text" | "delay" | "run";
    value: string;
};

type ActionTree = Command[];

type SwitchSettings = {
    tree0?: ActionTree;
    tree1?: ActionTree;
    treeHold?: ActionTree;
};
