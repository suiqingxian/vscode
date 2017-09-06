/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SpectronApplication } from '../../spectron/application';
import { Explorer } from '../explorer/explorer';
import { ActivityBar } from '../activitybar/activityBar';
import { Element } from 'webdriverio';
import { QuickOpen } from '../quickopen/quickopen';
import { Extensions } from '../extensions/extensions';
import { CommandPallette } from './commandPallette';
import { Search } from '../search/search';
import { Editor } from '../editor/editor';
import { SCM } from '../git/scm';
import { StatusBar } from '../statusbar/statusbar';
import { Problems } from '../problems/problems';
import { SettingsEditor } from '../preferences/settings';
import { KeybindingsEditor } from '../preferences/keybindings';

export class Workbench {

	readonly explorer: Explorer;
	readonly activitybar: ActivityBar;
	readonly commandPallette: CommandPallette;
	readonly quickopen: QuickOpen;
	readonly search: Search;
	readonly extensions: Extensions;
	readonly editor: Editor;
	readonly scm: SCM;
	readonly statusbar: StatusBar;
	readonly problems: Problems;
	readonly settingsEditor: SettingsEditor;
	readonly keybindingsEditor: KeybindingsEditor;

	constructor(private spectron: SpectronApplication) {
		this.explorer = new Explorer(spectron);
		this.activitybar = new ActivityBar(spectron);
		this.quickopen = new QuickOpen(spectron);
		this.commandPallette = new CommandPallette(spectron);
		this.search = new Search(spectron);
		this.extensions = new Extensions(spectron);
		this.editor = new Editor(spectron);
		this.scm = new SCM(spectron);
		this.statusbar = new StatusBar(spectron);
		this.problems = new Problems(spectron);
		this.settingsEditor = new SettingsEditor(spectron);
		this.keybindingsEditor = new KeybindingsEditor(spectron);
	}

	public async saveOpenedFile(): Promise<any> {
		try {
			await this.spectron.client.waitForElement('.tabs-container div.tab.active.dirty');
		} catch (e) {
			// ignore if there is no dirty file
			return Promise.resolve();
		}
		await this.spectron.command('workbench.action.files.save');
		return this.spectron.client.waitForElement('.tabs-container div.tab.active.dirty', element => !element);
	}

	public async selectTab(tabName: string, untitled: boolean = false): Promise<any> {
		await this.spectron.client.waitAndClick(`.tabs-container div.tab[aria-label="${tabName}, tab"]`);
		await this.waitForActiveOpen(tabName);
		return this.waitForEditorFocus(tabName, untitled);
	}

	public async waitForEditorFocus(fileName: string, untitled: boolean = false): Promise<Element> {
		return this.spectron.client.waitForElement(`.editor-container[aria-label="${fileName}. ${untitled ? 'Untitled file text editor.' : 'Text file editor.'}, Group 1."] .monaco-editor.focused`);
	}

	public async waitForActiveOpen(fileName: string, isDirty: boolean = false): Promise<boolean> {
		return this.spectron.client.waitForElement(`.tabs-container div.tab.active${isDirty ? '.dirty' : ''}[aria-selected="true"][aria-label="${fileName}, tab"]`).then(() => true);
	}

	public async waitForOpen(fileName: string, isDirty: boolean = false): Promise<boolean> {
		return this.spectron.client.waitForElement(`.tabs-container div.tab${isDirty ? '.dirty' : ''}[aria-label="${fileName}, tab"]`).then(() => true);
	}

	public async newUntitledFile(): Promise<any> {
		await this.spectron.command('workbench.action.files.newUntitledFile');
		await this.waitForActiveOpen('Untitled-1');
		await this.waitForEditorFocus('Untitled-1', true);
	}

	async openFile(fileName: string): Promise<void> {
		await this.quickopen.openFile(fileName);
		await this.spectron.client.waitForElement(`.monaco-editor.focused`);
	}
}
