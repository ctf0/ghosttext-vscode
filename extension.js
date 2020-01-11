const vscode = require('vscode')
const {
    Range,
    Position,
    workspace,
    window,
    commands,
    StatusBarAlignment,
    ProgressLocation
} = vscode
const http = require('http')
const ws = require('nodejs-websocket')

let myStatusBarItem
let httpStatusServer = null
let config = {}
let enabled = false

class OnMessage {
    constructor(webSocketConnection) {
        this.webSocketConnection = webSocketConnection
        let that = this
        this.onTextCallBack = (text) => that.onMessage(text)

        this.editor = null
        this.document = null
        this.webSocketConnection.on('text', this.onTextCallBack)
        this.webSocketConnection.on('close', this.doCleanup)
        this.remoteChangedText = null
        this.editorTitle = null
        this.cleanupCallback = null

        this.closed = false
    }

    doCleanup() {
        this.cleanupCallback && this.cleanupCallback()
    }

    updateEditorText(text) {
        this.editor.edit((editBuilder) => {
            let lineCount = this.editor.document.lineCount
            let lastLine = this.editor.document.lineAt(lineCount - 1)
            let endPos = lastLine.range.end
            let range = new Range(new Position(0, 0), endPos)

            editBuilder.delete(range)
            editBuilder.insert(new Position(0, 0), text)
        })
    }

    onMessage(text) {
        let request = JSON.parse(text)

        if (!this.editor) {
            workspace.openTextDocument({
                "language": config.default_syntax,
                "content": request.text
            }).then((textDocument) => {
                this.document = textDocument

                window.showTextDocument(textDocument).then((editor) => {
                    showMsg(`Editing "${request.title}"`, true)

                    this.editor = editor
                    this.updateEditorText(request.text)

                    workspace.onDidCloseTextDocument((doc) => {
                        if (doc == this.document && doc.isClosed) {
                            this.closed = true
                            this.webSocketConnection.close()
                            this.doCleanup()
                        }
                    })

                    workspace.onDidChangeTextDocument((event) => {
                        if (event.document == this.document) {
                            let changedText = this.document.getText()

                            if (changedText !== this.remoteChangedText) {
                                if (changedText) {
                                    this.remoteChangedText = changedText
                                }

                                let change = {
                                    title: this.editorTitle,
                                    text: changedText || this.remoteChangedText,
                                    syntax: "TODO",
                                    selections: []
                                }
                                change = JSON.stringify(change)

                                // empty doc change event fires before close. Work around race.
                                return setTimeout(() => this.closed || this.webSocketConnection.sendText(change), 50)
                            }
                        }
                    })
                })
            })
        } else {
            this.updateEditorText(request.text)

            return this.remoteChangedText = request.text
        }
    }
}

async function readConfig() {
    return config = await workspace.getConfiguration('ghosttext')
}

async function activate(context) {
    await readConfig()

    // config
    workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('ghosttext')) {
            await readConfig()
            createStatusBarItem()
        }
    })

    // command
    context.subscriptions.push(
        commands.registerCommand('extension.enableGhostText', async () => {
            let msg = null

            if (!enabled) {
                await initServer()
                enabled = true
                msg = 'is now enabled!'
            } else {
                msg = 'already enabled!'
            }

            await showMsg(msg)
        })
    )

    // statusbar
    context.subscriptions.push(createStatusBarItem())
}

async function createStatusBarItem(settings = config.statusbar) {
    if (myStatusBarItem) {
        myStatusBarItem.dispose()
    }

    myStatusBarItem = window.createStatusBarItem(StatusBarAlignment[settings.align], settings.priority)
    myStatusBarItem.command = 'extension.enableGhostText'
    myStatusBarItem.text = settings.text
    myStatusBarItem.tooltip = settings.tooltip
    myStatusBarItem.show()

    return myStatusBarItem
}

function initServer() {
    return new Promise((resolve) => {
        httpStatusServer = http.createServer((req, res) => {
            let wsServer = ws.createServer((conn) => new OnMessage(conn))

            wsServer.on('listening', () => {
                let response = {
                    ProtocolVersion: 1,
                    WebSocketPort: wsServer.socket.address().port
                }
                response = JSON.stringify(response)
                res.writeHead(200, { 'Content-Type': 'application/json' })

                return res.end(response)
            })

            return wsServer.listen(0)
        })

        httpStatusServer.listen(4001)

        resolve()
    })
}

function showMsg(msg, progress = false) {
    if (!progress) {
        return window.showInformationMessage(`Ghost Text: ${msg}`)
    }

    return window.withProgress({
        location: ProgressLocation.Notification,
        title: msg,
        cancellable: true
    }, async (progress, token) => {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve()
            }, config.notificationTimeout * 1000)
        })
    })
}

function deactivate() {
}

module.exports = {
    httpStatusServer,
    activate,
    deactivate
}
