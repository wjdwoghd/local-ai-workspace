import type { Page } from '@playwright/test';
export async function closeAppTool(page:Page){const close=page.getByRole('button',{name:'도구 닫기',exact:true});if(await close.isVisible())await close.click();}
export async function openAppTool(page:Page,name:string){await closeAppTool(page);await page.locator('.mode-tools > summary').click();await page.getByRole('button',{name,exact:true}).click();}
export async function showMode(page:Page,name:'Chat'|'Work'){await closeAppTool(page);await page.getByRole('navigation',{name:'주요 메뉴'}).getByRole('button',{name,exact:true}).click();}
