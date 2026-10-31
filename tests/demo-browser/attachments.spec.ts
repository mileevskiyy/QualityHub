import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
test('attach real screenshot, log and browser trace, then download exact evidence',async({page,context},testInfo)=>{
 await page.goto('/');await page.getByRole('button',{name:'Try the demo',exact:true}).click();
 const csrf=(await(await page.request.get('/api/auth/me')).json()).csrf;
 const headers={'X-CSRF-Token':csrf};
 const project=await(await page.request.post('/api/projects',{headers,data:{name:`Evidence browser ${Date.now()}`}})).json();
 const c=await(await page.request.post(`/api/projects/${project.id}/cases`,{headers,data:{title:'Screenshot evidence scenario',suite:'Evidence',priority:'high',steps:['Inspect page'],expected:'Evidence is retained'}})).json();
 const run=await(await page.request.post(`/api/projects/${project.id}/runs`,{headers,data:{name:'Attachment browser run',caseIds:[c.id]}})).json();
 await page.reload();await page.getByRole('combobox',{name:'Current project'}).selectOption(project.id);
 await page.getByRole('button',{name:'Test runs',exact:true}).click();await page.getByRole('button',{name:/Attachment browser run/}).click();
 await page.getByRole('button',{name:/Screenshot evidence scenario/}).click();
 const panel=page.getByRole('region',{name:'Execution attachments'});
 const png=await page.screenshot();
 await panel.getByLabel('Evidence file').setInputFiles({name:'browser.png',mimeType:'image/png',buffer:png});
 await panel.getByRole('button',{name:'Upload evidence'}).click();
 await expect(panel.getByRole('link',{name:'browser.png'})).toBeVisible();
 await panel.getByRole('button',{name:'Preview screenshot'}).click();
 await expect(panel.getByRole('img',{name:'Evidence: browser.png'})).toBeVisible();
 await panel.getByRole('button',{name:'Hide screenshot'}).click();
 await panel.getByLabel('Evidence type').selectOption('log');
 const bytes=Buffer.from('Actual browser evidence\n');
 await panel.getByLabel('Evidence file').setInputFiles({name:'browser.log',mimeType:'text/plain',buffer:bytes});
 await panel.getByRole('button',{name:'Upload evidence'}).click();
 await expect(panel.getByRole('link',{name:'browser.log'})).toBeVisible();
 const downloading=page.waitForEvent('download');await panel.getByRole('link',{name:'browser.log'}).click();
 const download=await downloading,stream=await download.createReadStream();let actual=Buffer.alloc(0);for await(const chunk of stream!)actual=Buffer.concat([actual,chunk]);expect(actual.equals(bytes)).toBe(true);
 // Produce an actual Playwright trace; never execute or unpack uploaded archives on the server.
 await context.tracing.start({screenshots:true,snapshots:true});await page.getByLabel('Evidence type').selectOption('trace');
 const tracePath=testInfo.outputPath('actual-trace.zip');await context.tracing.stop({path:tracePath});
 await panel.getByLabel('Evidence file').setInputFiles({name:'actual-trace.zip',mimeType:'application/zip',buffer:await readFile(tracePath)});
 await panel.getByRole('button',{name:'Upload evidence'}).click();await expect(panel.getByRole('link',{name:'actual-trace.zip'})).toBeVisible();
 const metadata=await(await page.request.get(`/api/projects/${project.id}/results/${run.results[0].id}/attachments`)).json();
 expect(metadata).toHaveLength(3);expect(metadata.find((a:any)=>a.filename==='browser.png').sha256).toBe(createHash('sha256').update(png).digest('hex'));
 await page.getByRole('button',{name:'Close dialog'}).click();await page.getByRole('button',{name:/Screenshot evidence scenario/}).click();
 await expect(page.getByRole('link',{name:'actual-trace.zip'})).toBeVisible();
 if(!process.env.DEMO_URL){await page.screenshot({path:'docs/evidence.png'});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/evidence-mobile.png'});}
});
