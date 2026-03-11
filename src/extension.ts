import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';

const ONBOARDING_KEY = 'talknote.onboarding.completed';

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}${month}${day}`;
}

function timestamp(date: Date): string {
  return date.toISOString();
}

function toTalkId(projectName: string, yyyymmdd: string): string {
  return createHash('sha1').update(`${projectName}-${yyyymmdd}`).digest('hex').slice(0, 8);
}

function flattenResponseParts(parts: readonly (vscode.ChatResponseMarkdownPart | vscode.ChatResponseFileTreePart | vscode.ChatResponseAnchorPart | vscode.ChatResponseCommandButtonPart)[]): string {
  let text = '';
  for (const part of parts) {
    if (part instanceof vscode.ChatResponseMarkdownPart) {
      text += part.value.value;
    }
  }
  return text.trim();
}

async function ensureTalkFolder(rootPath: string): Promise<string> {
  const folder = path.join(rootPath, '.talknote');
  await fs.mkdir(folder, { recursive: true });
  return folder;
}

async function appendInteraction(rootPath: string, userPrompt: string, assistantReply: string): Promise<void> {
  const projectName = path.basename(rootPath);
  const now = new Date();
  const date = formatDate(now);
  const talkId = toTalkId(projectName, date);
  const folder = await ensureTalkFolder(rootPath);
  const fileName = `${projectName}-${date}-${talkId}.md`;
  const filePath = path.join(folder, fileName);

  const config = vscode.workspace.getConfiguration('talknote');
  const separator = config.get<string>('separator', '------------------------------');

  const section = [
    `## ${timestamp(now)}`,
    '',
    '### User',
    '',
    userPrompt,
    '',
    '### Copilot',
    '',
    assistantReply || '(empty response)',
    '',
    separator,
    ''
  ].join('\n');

  try {
    await fs.access(filePath);
  } catch {
    const header = `# ${projectName} Copilot Talk Log (${date})\n\n`;
    await fs.writeFile(filePath, header, { encoding: 'utf8' });
  }

  await fs.appendFile(filePath, section, { encoding: 'utf8' });
}

export function activate(context: vscode.ExtensionContext): void {
  const handler: vscode.ChatRequestHandler = async (request, chatContext, stream, token) => {
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!rootPath) {
      stream.markdown('No workspace folder detected.');
      return;
    }

    const messages: vscode.LanguageModelChatMessage[] = [];
    const history = chatContext.history;

    for (const turn of history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      } else if (turn instanceof vscode.ChatResponseTurn) {
        const assistantText = flattenResponseParts(turn.response);
        if (assistantText) {
          messages.push(vscode.LanguageModelChatMessage.Assistant(assistantText));
        }
      }
    }

    messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

    const response = await request.model.sendRequest(messages, {}, token);
    let assistantReply = '';

    for await (const chunk of response.text) {
      assistantReply += chunk;
      stream.markdown(chunk);
    }

    await appendInteraction(rootPath, request.prompt, assistantReply.trim());
  };

  const participant = vscode.chat.createChatParticipant('talknote.copilot', handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'talknote.svg');

  context.subscriptions.push(participant);

  const openTalkNoteChat = vscode.commands.registerCommand('talknote.openChat', async () => {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: '@talknote '
      });
    } catch {
      await vscode.commands.executeCommand('workbench.action.chat.open');
      await vscode.window.showInformationMessage('已打开 Chat。请在输入框中输入 @talknote 后开始对话。');
    }
  });

  context.subscriptions.push(openTalkNoteChat);
  const reopenOnboarding = vscode.commands.registerCommand('talknote.reopenOnboarding', async () => {
    await context.globalState.update(ONBOARDING_KEY, false);
    await vscode.window.showInformationMessage('TalkNote 引导已重置，下一次激活时会重新提示。');
  });
  context.subscriptions.push(reopenOnboarding);

  const output = vscode.window.createOutputChannel('TalkNote');
  context.subscriptions.push(output);

  const quickPrompt = vscode.commands.registerCommand('talknote.quickPrompt', async () => {
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!rootPath) {
      vscode.window.showErrorMessage('未检测到工作区文件夹，无法发送 prompt。');
      return;
    }

    let prompt = '';
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      prompt = editor.document.getText(editor.selection).trim();
    }

    if (!prompt) {
      const input = await vscode.window.showInputBox({ prompt: '输入要发送到 Copilot 的提示（Quick Prompt）' });
      if (!input) { return; }
      prompt = input.trim();
    }

    output.appendLine(`Prompt: ${prompt}`);

    try {
      const models = await (vscode as any).lm.selectChatModels({ vendor: 'copilot' });
      const model = models && models.length > 0 ? models[0] : undefined;
      if (!model) {
        vscode.window.showErrorMessage('未找到可用的 Copilot 聊天模型。');
        return;
      }

      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const response = await model.sendRequest(messages, {}, undefined);
      let assistantReply = '';
      for await (const chunk of response.text) {
        assistantReply += chunk;
        // optional: stream to output
        output.append(chunk);
      }
      const config = vscode.workspace.getConfiguration('talknote');
      const separator = config.get<string>('separator', '------------------------------');
      output.appendLine('\n' + separator);

      await appendInteraction(rootPath, prompt, assistantReply.trim());
      vscode.window.showInformationMessage('TalkNote: 已记录对话到 .talknote。');
    } catch (err) {
      output.appendLine(`Error: ${String(err)}`);
      vscode.window.showErrorMessage('发送到 Copilot 或记录时出错，查看 TalkNote 输出了解详情。');
    }
  });
  context.subscriptions.push(quickPrompt);

  void (async () => {
    const completed = context.globalState.get<boolean>(ONBOARDING_KEY, false);
    if (completed) {
      return;
    }

    const selectNow = '立即切换';
    const skip = '稍后';
    const choice = await vscode.window.showInformationMessage(
      'TalkNote 已安装。为开启自动记录，请首次切换到 @talknote 参与者。',
      selectNow,
      skip
    );

    if (choice === selectNow) {
      await vscode.commands.executeCommand('talknote.openChat');
    }

    await context.globalState.update(ONBOARDING_KEY, true);
  })();
}

export function deactivate(): void {}
