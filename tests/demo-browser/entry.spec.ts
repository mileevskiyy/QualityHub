import {test,expect} from '@playwright/test';
test('visitor can enter seeded workspace and create a test case',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Try the demo',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Current project'})).toContainText('Commerce web');
 await page.getByRole('button',{name:'New test case',exact:true}).first().click();
 const title=`Demo browser check ${Date.now()}`;
 await page.getByLabel('Title',{exact:true}).fill(title);
 await page.getByLabel('Step 1',{exact:true}).fill('Open the storefront');
 await page.getByLabel('Expected result',{exact:true}).fill('Storefront is displayed');
 await page.getByRole('button',{name:'Create test case',exact:true}).click();
 await page.getByRole('button',{name:'Test library',exact:true}).click();
 await expect(page.getByRole('button',{name:new RegExp(title)})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('combobox',{name:'Current project'})).toContainText('Commerce web');
});
