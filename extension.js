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

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            lastEditor = editor;
        }
    });
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
                    const res = await fetch("http://localhost:5000/api/ai", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt })
                    });

                    const data = await res.json();

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

                const text = data.response ?? "";

                // Insert text
                await editor.edit(editBuilder => {
                    if (!editor.selection.isEmpty) {
                        editBuilder.replace(editor.selection, text);
                    } else {
                        editBuilder.insert(editor.selection.active, text);
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
        <button id="voiceBtn">🎙 Start Voice</button>
        <input id="input-text" placeholder="Enter text"/>

        <script>
            const vscode = acquireVsCodeApi();
            const inputText = document.getElementById("input-text");
            document.getElementById("voiceBtn").addEventListener("click", () => {
                vscode.postMessage({
                    command: "voiceClicked",
                    text: inputText.value
                });
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