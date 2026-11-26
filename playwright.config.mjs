import {defineConfig, devices} from '@playwright/test';
const fake = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=tests/voz-teste.wav'];
export default defineConfig({
	testDir: 'tests',
	testMatch: /.*\.spec\.mjs/,
	timeout: 90000,
	workers: 1,
	use: {baseURL: 'http://localhost:5500', trace: 'retain-on-failure', permissions: ['microphone'], launchOptions: {args: fake}},
	projects: [
		{name: 'celular', use: {...devices['Pixel 7'], launchOptions: {args: fake}}},
		{name: 'computador', use: {viewport: {width: 1280, height: 800}, launchOptions: {args: fake}}},
	],
});
