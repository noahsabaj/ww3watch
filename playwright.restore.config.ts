import base from './playwright.config'
import { defineConfig } from '@playwright/test'
export default defineConfig({...base,testDir:'e2e-restore',retries:0,reporter:'list',use:{...base.use,trace:'off',screenshot:'off',video:'off'}})
