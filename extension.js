//extension.js

// @ts-check

const vscode = require('vscode');
const fetch = require("node-fetch");
/** @type {import('vscode').TextEditor | null} */

/** @type {import('vscode').TextEditor | null} */
let lastEditor = null;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

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
                        fileName
                    })
                });

                // Check HTTP status before reading body
                if (!res.ok) {
                    const errorBody = await res.text();
                    throw new Error(`Server returned ${res.status}: ${errorBody}`);
                }

                // Read body exactly once
                const data = await res.json();

                console.log("Server response:", data);
                console.log("Selected Code:", selectedCode);
                console.log("Full Code Length:", fullCode.length);
                console.log("Language:", language);
                console.log("File Name:", fileName);

                const text = typeof data.response === 'string' ? data.response : '';

                // Insert text
                const selection = editor.selection;
                await editor.edit(editBuilder => {
                    if (!selection.isEmpty) {
                        editBuilder.replace(selection, text);
                    } else {
                        editBuilder.insert(selection.active, text);
                    }
                });
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage("Error: " + message);
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
    <body>
        <h1>VoxCode AI</h1>

        <input id="input-text" placeholder="Enter text"/>
        <button id="sendTextBtn">Send Text</button>

        <br><br>

        <button id="startBtn">🎤 Start Listening</button>
        <p id="output">Speech will appear here...</p>

        <script>
            const vscode = acquireVsCodeApi();

            const inputText = document.getElementById("input-text");
            const output = document.getElementById("output");
            const startBtn = document.getElementById("startBtn");
            const sendBtn = document.getElementById("sendTextBtn");

            // ✅ Speech Recognition Setup
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

            if (!SpeechRecognition) {
                output.innerText = "Speech Recognition not supported in this environment";
            } else {
                const recognition = new SpeechRecognition();

                recognition.lang = "en-US";
                recognition.continuous = false;

                // 🎤 Start Listening
                startBtn.addEventListener("click", () => {
                    recognition.start();
                    output.innerText = "Listening...";
                });

                // 🧠 When speech is captured
                recognition.onresult = (event) => {
                    const text = event.results[0][0].transcript;
                    output.innerText = text;

                    vscode.postMessage({
                        command: "voiceClicked",
                        text: text
                    });
                };

                // ❗ Error handling
                recognition.onerror = (event) => {
                    output.innerText = "Error: " + event.error;
                    console.log("Speech error:", event.error);
                };
            }

            // ⌨️ Text input send
            sendBtn.addEventListener("click", () => {
                const text = inputText.value;
                if (!text) return;

                vscode.postMessage({
                    command: "voiceClicked",
                    text: text
                });

                inputText.value = "";
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