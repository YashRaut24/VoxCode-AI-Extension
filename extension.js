//extension.js

// @ts-check
console.log("=== VOXCODE EXTENSION FILE LOADED ===");
const vscode = require('vscode');
const fetch = require("node-fetch");
const path = require('path');
/** @type {import('vscode').TextEditor | null} */

/** @type {import('vscode').TextEditor | null} */
let lastEditor = null;

const ALLOWED_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.json', '.md', '.css', '.html', '.go', '.rs', '.c', '.cpp', '.cs'];
const EXCLUDED_PATH_SEGMENTS = ['node_modules', '.git', 'dist', 'build', '.vscode-test'];
const EXCLUDED_FILENAMES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
const MAX_ADDITIONAL_FILES = 5;
const MAX_CHARS_PER_FILE = 2000;
const MAX_TOTAL_CONTEXT_CHARS = 8000;

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isEligibleFile(filePath) {
    const fileName = path.basename(filePath);
    const hasAllowedExtension = ALLOWED_EXTENSIONS.some(ext => filePath.endsWith(ext));
    const isExcludedPath = EXCLUDED_PATH_SEGMENTS.some(segment => filePath.includes(segment));
    const isExcludedFile = EXCLUDED_FILENAMES.includes(fileName);
    return hasAllowedExtension && !isExcludedPath && !isExcludedFile;
}   
/**
 * @param {string} activeFileName
 * @returns {Promise<Array<{fileName: string, content: string}>>}
 */
async function gatherWorkspaceContext(activeFileName) {
    /** @type {Array<{fileName: string, content: string}>} */
    const fileContents = [];
   /** @type {Set<string>} */
    const seenPaths = new Set();
        let totalChars = 0;
    /**
 * @param {string} filePath
 * @param {string} content
 */
function addFile(filePath, content) {
        if (seenPaths.has(filePath)) return false;
        if (fileContents.length >= MAX_ADDITIONAL_FILES) return false;
        if (totalChars >= MAX_TOTAL_CONTEXT_CHARS) return false;

        const truncated = content.slice(0, MAX_CHARS_PER_FILE);
        fileContents.push({ fileName: filePath, content: truncated });
        seenPaths.add(filePath);
        totalChars += truncated.length;
        return true;
    }

    // 1. Open editor tabs
    for (const editor of vscode.window.visibleTextEditors) {
        const filePath = editor.document.fileName;
        if (filePath === activeFileName) continue; // skip the active file, already sent separately
        if (!isEligibleFile(filePath)) continue;

        addFile(filePath, editor.document.getText());
    }

    // 2. Sibling files in the same directory as the active file
    try {
        const activeDirPath = path.dirname(activeFileName);
        const activeDir = vscode.Uri.file(activeDirPath);
        const dirEntries = await vscode.workspace.fs.readDirectory(activeDir);

        for (const [name, type] of dirEntries) {
            if (type !== vscode.FileType.File) continue;

            const siblingPath = path.join(activeDirPath, name);
            if (siblingPath === activeFileName) continue;
            if (!isEligibleFile(siblingPath)) continue;
            if (seenPaths.has(siblingPath)) continue;

            try {
                const fileUri = vscode.Uri.file(siblingPath);
                const bytes = await vscode.workspace.fs.readFile(fileUri);
                const content = Buffer.from(bytes).toString('utf8');
                addFile(siblingPath, content);
            } catch (readErr) {
                const message = readErr instanceof Error ? readErr.message : String(readErr);
                console.log("Skipping unreadable sibling file:", siblingPath, "Reason:", message);
            }
        }
    } catch (dirErr) {
        const message = dirErr instanceof Error ? dirErr.message : String(dirErr);
        console.log("Could not read sibling directory:", message);
    }

    return fileContents;
}



/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

    const outputChannel = vscode.window.createOutputChannel("VoxCode AI");
    context.subscriptions.push(outputChannel);

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                lastEditor = editor;
            }
        })
    );
    const disposable = vscode.commands.registerCommand('voxcode.openPanel', function () {

        const panel = vscode.window.createWebviewPanel(
            'voxcodePanel',
            'VoxCode AI',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = getWebviewContent();

        panel.webview.onDidReceiveMessage(async (message) => {

            if (message.command === "voiceClicked") {

                const prompt = message.text ?? "";

                panel.webview.postMessage({ status: "loading" });

                try {
              

                    console.log("Active Editor:", vscode.window.activeTextEditor);
                    console.log("Visible Editors:", vscode.window.visibleTextEditors.length);

                // 🔥 ALWAYS get fresh editor
                // Try to get current editor and Works only if editor is focused
                let editor = vscode.window.activeTextEditor;

                // If not available, use last editor's document
                if (!editor && lastEditor) {
                    try {
                        editor = await vscode.window.showTextDocument(lastEditor.document);
                    } catch (e) {
                        editor = undefined;
                    }
                }

                // If still no editor → create new file
                if (!editor) {
                    const doc = await vscode.workspace.openTextDocument({
                        language: 'javascript',
                        content: ''
                    });
                    editor = await vscode.window.showTextDocument(doc);
                }

                const selectedCode = editor.document.getText(editor.selection);

                const fullCode = editor.document.getText();

                const language = editor.document.languageId;

                const fileName = editor.document.fileName;

                console.log({
                    prompt,
                    selectedCode,
                    language,
                    fileName
                });

                const workspaceContext = await gatherWorkspaceContext(fileName);
                console.log(`Gathered ${workspaceContext.length} additional context files`);
                console.log(JSON.stringify(workspaceContext.map(f => ({ fileName: f.fileName, length: f.content.length }))));

                const config = vscode.workspace.getConfiguration('voxcode');
                const serverUrl = config.get('serverUrl') ?? 'http://localhost:5000';
                const endpoint = `${serverUrl}/api/ai`;

               const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        prompt,
        selectedCode,
        fullCode,
        language,
        fileName,
        workspaceContext
    })
});

if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Server returned ${res.status}: ${errorBody}`);
}

// --- Streaming response handler ---
outputChannel.clear();
outputChannel.appendLine(`[VoxCode] ${prompt}`);
outputChannel.appendLine("");
outputChannel.show(true);

panel.webview.postMessage({ status: "streaming" });

let fullText = "";
let streamBuffer = "";

await new Promise((resolve, reject) => {
    res.body.on("data", (chunk) => {
        streamBuffer += chunk.toString();
        const lines = streamBuffer.split("\n");
        streamBuffer = lines.pop() ?? "";

        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();

            if (data === "[DONE]") {
                resolve(undefined);
                return;
            }

            try {
                const parsed = JSON.parse(data);

                if (parsed.error) {
                    reject(new Error(parsed.error));
                    return;
                }

                if (parsed.token) {
                    fullText += parsed.token;
                    outputChannel.append(parsed.token);
                }
            } catch {
                // skip malformed chunks
            }
        }
    });

    res.body.on("end", () => resolve(undefined));
    res.body.on("error", (err) => reject(err));
});

// --- Parse intent from first line ---
const lines = fullText.split("\n");
const firstLine = lines[0].trim();
let intent = "WRITE";
let responseText = fullText;

if (firstLine.startsWith("INTENT:")) {
    intent = firstLine.replace("INTENT:", "").trim();
    responseText = lines.slice(1).join("\n").trim();
}

console.log("Intent received:", intent);
console.log("Full response length:", fullText.length);

// --- Act based on intent ---
if (intent === "WRITE" || intent === "REFACTOR") {
    const selection = editor.selection;
    await editor.edit(editBuilder => {
        if (!selection.isEmpty) {
            editBuilder.replace(selection, responseText);
        } else {
            editBuilder.insert(selection.active, responseText);
        }
    });
}

// Update Output Channel header with real intent
outputChannel.clear();
outputChannel.appendLine(`[${intent}] ${prompt}`);
outputChannel.appendLine("");
outputChannel.appendLine(responseText);

panel.webview.postMessage({ status: "success" });
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage("Error: " + message);
                    panel.webview.postMessage({ status: "error", message });
                }
            }
        });

    });

    context.subscriptions.push(disposable);
}

function getWebviewContent() {
    return `
    <!DOCTYPE html>
    <html>
    <head>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }

        h1 {
            font-size: 1.3em;
            margin-bottom: 16px;
        }

        .input-row {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }

        input {
            flex: 1;
            padding: 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 1em;
        }

        input:disabled {
            opacity: 0.5;
        }

        button {
            padding: 8px 14px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 1em;
        }

        button:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .voice-row {
            margin-bottom: 16px;
        }

        #status {
            padding: 10px;
            border-radius: 4px;
            font-size: 0.95em;
            min-height: 20px;
        }

        .status-idle {
            color: var(--vscode-descriptionForeground);
        }

        .status-loading {
            color: var(--vscode-charts-yellow);
        }

        .status-success {
            color: var(--vscode-charts-green);
        }

        .status-error {
            color: var(--vscode-errorForeground);
        }

        .spinner {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid var(--vscode-charts-yellow);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 6px;
            vertical-align: middle;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
    </head>
    <body>
        <h1>VoxCode AI</h1>

        <div class="input-row">
            <input id="input-text" placeholder="Type a coding instruction..."/>
            <button id="sendTextBtn">Send</button>
        </div>

        <div class="voice-row">
            <button id="startBtn">🎤 Start Listening</button>
        </div>

        <div id="status" class="status-idle">Ready</div>

        <script>
            const vscode = acquireVsCodeApi();

            const inputText = document.getElementById("input-text");
            const status = document.getElementById("status");
            const startBtn = document.getElementById("startBtn");
            const sendBtn = document.getElementById("sendTextBtn");

            let currentState = "idle";

            function setState(state, message) {
                currentState = state;

                const isBusy = state === "loading" || state === "streaming";
                inputText.disabled = isBusy;
                sendBtn.disabled = isBusy;
                startBtn.disabled = isBusy;

                status.className = "status-" + state;

                if (state === "loading") {
                    status.innerHTML = '<span class="spinner"></span>Connecting...';
                } else if (state === "streaming") {
                    status.innerHTML = '<span class="spinner"></span>VoxCode is writing...';
                } else if (state === "success") {
                    status.innerText = "Done ✓";
                } else if (state === "error") {
                    status.innerText = message || "Something went wrong. Try again.";
                } else {
                    status.innerText = "Ready";
                }

                // Auto-return to idle after success or error
                if (state === "success" || state === "error") {
                    setTimeout(() => {
                        if (currentState === state) {
                            setState("idle");
                        }
                    }, 3000);
                }
            }

            // Listen for status updates from the extension
            window.addEventListener("message", (event) => {
                const data = event.data;
                if (data.status) {
                    setState(data.status, data.message);
                }
            });

            function sendPrompt(text) {
                if (!text || currentState === "loading") return;

                vscode.postMessage({
                    command: "voiceClicked",
                    text: text
                });
            }

            // Speech Recognition Setup
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

            if (!SpeechRecognition) {
                startBtn.disabled = true;
                startBtn.title = "Speech Recognition not supported in this environment";
            } else {
                const recognition = new SpeechRecognition();
                recognition.lang = "en-US";
                recognition.continuous = false;

                startBtn.addEventListener("click", () => {
                    if (currentState === "loading") return;
                    recognition.start();
                    status.className = "status-loading";
                    status.innerText = "Listening...";
                });

                recognition.onresult = (event) => {
                    const text = event.results[0][0].transcript;
                    sendPrompt(text);
                };

                recognition.onerror = (event) => {
                    setState("error", "Speech error: " + event.error);
                };
            }

            // Text input send
            sendBtn.addEventListener("click", () => {
                const text = inputText.value;
                sendPrompt(text);
                inputText.value = "";
            });

            inputText.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    sendBtn.click();
                }
            });
        </script>
    </body>
    </html>
    `;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};