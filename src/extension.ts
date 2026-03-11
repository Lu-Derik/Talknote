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
    '---',
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
