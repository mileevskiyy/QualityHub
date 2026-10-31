import {test,expect} from '@playwright/test';
test('imported run exposes its supplied repository, commit and CI source',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Try the demo',exact:true}).click();await expect(page.getByRole('combobox',{name:'Current project'})).toBeVisible();
 const headers={'X-CSRF-Token':(await(await page.request.get('/api/auth/me')).json()).csrf};
 const project=await(await page.request.post('/api/projects',{headers,data:{name:`Source browser ${Date.now()}`}})).json();
 const source={repository:'mileevskiyy/OrderFlow',commit:'a'.repeat(40),buildUrl:'https://github.com/mileevskiyy/OrderFlow/actions/runs/123',scenario:'browser fixture',dirty:true};
 const result=await page.request.post(`/api/projects/${project.id}/imports/playwright`,{headers,data:{externalId:'source-browser-fixture',name:'Source metadata fixture',source,tests:[{externalId:'checkout',title:'Checkout test',suite:'chromium',attempts:[{retry:0,status:'passed',durationMs:20}]}]}});expect(result.ok()).toBe(true);
 await page.reload();await page.getByRole('combobox',{name:'Current project'}).selectOption(project.id);await page.getByRole('button',{name:'Test runs',exact:true}).click();await page.getByRole('button',{name:/Source metadata fixture/}).click();
 await expect(page.getByText('Automation source',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:/mileevskiyy\/OrderFlow/})).toHaveAttribute('href',`https://github.com/mileevskiyy/OrderFlow/commit/${source.commit}`);
 await expect(page.getByRole('link',{name:'Open CI execution'})).toHaveAttribute('href',source.buildUrl);
 await expect(page.getByText(/local working tree had uncommitted changes/)).toBeVisible();
 await expect(page.getByText(/it is not a signed build attestation/)).toBeVisible();
});
