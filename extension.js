const vscode = require('vscode');

function activate(context) {

    let disposable = vscode.commands.registerCommand('voxcode.openPanel', function () {

        const panel = vscode.window.createWebviewPanel(
            'voxcodePanel',
            'VoxCode AI',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = getWebviewContent();

        // 👇 THIS IS IMPORTANT
        panel.webview.onDidReceiveMessage(
            message => {
                if (message.command === "voiceClicked") {
                    console.log("Message from Webview:", message.text);
                    vscode.window.showInformationMessage(message.text);
                }
            },
            undefined,
            context.subscriptions
        );

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

            <script>
                const vscode = acquireVsCodeApi();

                document.getElementById("voiceBtn").addEventListener("click", () => {
                    vscode.postMessage({
                        command: "voiceClicked",
                        text: "User clicked voice button"
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