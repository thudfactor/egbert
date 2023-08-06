import * as vscode from 'vscode';
import { ChatCompletionResponseMessage, Configuration, OpenAIApi } from 'openai';
import { parse, stringify } from 'yaml';

type EgbertConfType = {
  apiKey?: string;
  model: string;
  temperature: number;
  context: string;
  instructions: Record<string, string>;
};

/**
 * function getSettingsFromYML
 * 
 * Loads settings for the VSCode extension from a file called "egbert.yml" in the root directory of the workspace.
 * 
 * @returns An object containing the settings for the extension provided in the egbert.yaml file.
 */
async function getSettingsFromYML(): Promise<any> {
  const workspaceUri = vscode.workspace.workspaceFolders?.[0].uri || '';
  if (!workspaceUri) {
    return {};
  }
  
  try {
    const data = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(workspaceUri, 'egbert.yaml'));
    return parse(data.toString());
  } catch (e: any) {
    vscode.window.showWarningMessage('No egbert.yaml file found in the root directory of your workspace, usung default settings.');
    // create a VSCode channel
    const channel = vscode.window.createOutputChannel('Egbert');
    channel.append(e.toString());
    return {};
  }
};

/** 
 * function getOpenAI
 * 
 * Given an API Key, return an instance of the openAI API. 
 * 
 * @param key The API key to use for the OpenAI API
 * 
 * @returns An instance of the OpenAI API
*/
function getOpenAI(key: string): OpenAIApi | false {
  if(!key) {
    vscode.window.showErrorMessage('No API key found. Please add your OpenAI API key to your settings.');
    return false;
  }
  return new OpenAIApi(new Configuration({ 
    apiKey: key,
  }));
}

/**
 * function getSettings 
 * 
 * Loads settings for the VSCode extension from a file called "egbert.yml" in the root directory of the workspace, as well
 * as locating the API key for the OpenAI API either from the egbert.yaml file or from the VSCode settings.
 * 
 * @returns EgbertConfType
 */

async function getSettings(): Promise<EgbertConfType> {
  // Load settings from the Egbert YAML file
  const egbertConf:EgbertConfType = await getSettingsFromYML();

  const apiKey = vscode.workspace.getConfiguration('egbert').get('openAIKey') as string || '';

  const defaultConf = {
    model: 'gpt-3.5-turbo',
    temperature: 0.4,
    context: 'You are a skilled editor for a weblog. It is your job to read blog posts and provide the requested information.',
    instructions: {
      suggestedTitles: "Provide three catchy titles for this post. Use the field name 'titles'.",
      summaries: "Provide three amusing SEO-optimized summaries of the post. Avoid calls to action. Use the field name 'summaries'.",
      sentiment: "Provide a sentiment analysis of the post in a paragraph. Use the field name 'sentiment'.",
    },
  };

  return { apiKey, ...defaultConf, ...egbertConf };
}

function instructionsObjectToPromptString(instructions: Record<string, string>) {
  return Object.entries(instructions).map(([key, value]) => `${value} (Use the field name ${key})`).join('\n');
}

export default async function getMetadata() {
  const egbertConf:EgbertConfType = await getSettings();

  if(!egbertConf.apiKey) {
    vscode.window.showErrorMessage('No API key found. Please add your OpenAI API key to egbert.yaml in your project root directory.');
    return;
  }

  const openai = getOpenAI(egbertConf.apiKey);

  if (!openai) {
    vscode.window.showErrorMessage('Failed to create openAI instance');
    vscode.window.createOutputChannel('Egbert').append('Failed to create openAI instance');
    return;
  }

  const text = vscode.window.activeTextEditor?.document.getText();

  if(!text) {
    vscode.window.showErrorMessage('No text found');
    return;
  }

  const rawYamlBlock = text.match(/---[\s\S]*---/)?.[0] || '';
  const lineCount = rawYamlBlock.split('\n').length;
  const yamlBlock = rawYamlBlock.replace(/---/g, '');

  const originalMetadata = yamlBlock ? parse(yamlBlock) : {};

  const textWithoutYamlBlock = text.replace(/---[\s\S]*---/, '');

  const instructionsToPrompt = instructionsObjectToPromptString(egbertConf.instructions);

  const prompt = `
  Please read the post provided between the delimiters '///' and provide the following:

  ${instructionsToPrompt}

  Provide your full response in YAML format.
  If a step requests multiple answers, provide those as a list under the appropriate field.

  ///
  ${textWithoutYamlBlock}
  ///
  `;

  const messages: ChatCompletionResponseMessage[] = [
    {role: "system", content: egbertConf.context},
    {role: "user", content: prompt},
  ];

  let metaResult = '';
  
  vscode.window.showInformationMessage('Egbert is thinking…');
  try {
    const chatResponse = await openai.createChatCompletion({
      model: egbertConf.model || 'gpt-3.5-turbo',
      temperature: egbertConf.temperature,
      messages,
    });
    metaResult = chatResponse.data.choices[0].message?.content || '---\n---';
  } catch (e: any) {
    vscode.window.showErrorMessage('Egbert failed to think.');
    vscode.window.createOutputChannel('Egbert').append(e.toString());
    console.log(e);
    return;
  }
  vscode.window.showInformationMessage('Egbert is done thinking.');

  let metaResultObject = {};
  try {
    metaResultObject = { egbert: parse(metaResult.replace(/---[\s\S]*---/, '')) };
  } catch (e: any) {
    vscode.window.showErrorMessage('Failed to parse YAML');
    vscode.window.createOutputChannel('Egbert').append(e.toString());
    metaResultObject = {
      egbertUnparsableResponse: metaResult.replace(/---[\s\S]*---/, ''),
    };
  }
  const joinedMetadata = {...originalMetadata, ...metaResultObject};

  vscode.window.activeTextEditor?.edit(editBuilder => {
    editBuilder.replace(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lineCount, 10000)), `---\n${stringify(joinedMetadata)}\n---\n`);
  });
}



