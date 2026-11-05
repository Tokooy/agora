/* Production-browser smoke test. No real DeepSeek key or paid API calls. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const base = process.env.AGORA_URL || 'http://localhost:3000';
const output = path.resolve(__dirname, '../test-results');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {})});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const errors = [], cleanup = [];
  page.on('pageerror', e => errors.push(e.message));
  let testKeys = {shared:false, agents:{}};
  let finalSession;
  try {
    // Keep test credentials in browser-route mocks, never in the real server.
    await page.route('**/api/bootstrap', async route => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({json:{...data, keys:testKeys}});
    });
    await page.route('**/api/settings', async route => {
      const body = route.request().postDataJSON();
      testKeys = {shared:!!body.shared_key, agents:Object.fromEntries(Object.keys(body.agent_keys || {}).map(id=>[id,true]))};
      await route.fulfill({json:testKeys});
    });
    await page.goto(base);
    await page.locator('.wizard-step').waitFor();
    await page.screenshot({path:path.join(output,'01-onboarding.png'), fullPage:true});
    await page.locator('.number-grid button').nth(1).click();
    await page.getByRole('button',{name:'下一步：命名与连接'}).click();
    assert.equal(await page.locator('.agent-form').count(),2);
    await page.getByLabel('Agent 1 名称',{exact:true}).fill('证据研究员');
    await page.getByLabel('Agent 2 名称',{exact:true}).fill('反方审稿人');
    await page.getByLabel('Agent 1 API Key',{exact:true}).fill('test-key-one-never-sent');
    await page.getByLabel('Agent 2 API Key',{exact:true}).fill('test-key-two-never-sent');
    await page.getByRole('button',{name:'完成配置，进入工作台'}).click();
    await page.locator('.empty-state').waitFor();
    assert.match(await page.locator('.team-list').innerText(),/证据研究员/);
    const stored = await page.evaluate(()=>localStorage.getItem('agora-config'));
    assert.ok(!stored.includes('test-key'));
    await page.screenshot({path:path.join(output,'02-workbench.png'), fullPage:true});
    console.log('PASS: first-run count, custom names, independent API entry, no secrets in browser storage');

    const uploadResult = page.waitForResponse(r=>r.url().endsWith('/api/documents')&&r.request().method()==='POST');
    await page.locator('input[type=file]').setInputFiles({name:'browser-check.html',mimeType:'text/html',buffer:Buffer.from('<h1>浏览器测试报告</h1><p>用户从100增至120</p><script>window.__injected=true</script>')});
    const uploaded = await (await uploadResult).json();
    cleanup.push(uploaded.id);
    await page.getByText('browser-check.html',{exact:true}).first().waitFor();
    await page.locator('.file-item button').first().click();
    await page.getByRole('dialog').waitFor();
    const source = await page.locator('.source-code').innerText();
    assert.ok(source.includes('浏览器测试报告'));
    assert.ok(!source.includes('window.__injected'));
    assert.equal(await page.evaluate(()=>window.__injected),undefined);
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    console.log('PASS: HTML upload reaches real backend; extracted preview excludes executable scripts');

    await page.evaluate(() => {
      window.EventSource = class extends window.EventSource {
        constructor(url) {
          super(url);
          window.discussionStream = this;
        }
      };
    });
    let remainingEvents;
    const pausedUpdate = '正在阅读前文时收到的新发言。';
    await page.route('**/api/sessions', async route=>{
      if(route.request().method()!=='POST')return route.continue();
      const body=route.request().postDataJSON();
      const agent=body.agents[0];
      const critic=body.agents[1];
      const now=Date.now()/1000;
      const one={id:'test-m1',agent_id:agent.id,agent_name:agent.name,color:agent.color,round:1,kind:'discussion',content:'',status:'streaming',created:now};
      const two={id:'test-m2',agent_id:critic.id,agent_name:critic.name,color:critic.color,round:body.rounds+1,kind:'summary',content:'',status:'streaming',created:now};
      const text='**核验结果：增长 20%。** [D1:L2]\n\n' + '原文所述数值可用于计算。\n\n'.repeat(40);
      const report='## 修订建议\n\n用户从100增至120，增长率为20%。[D1:L2]';
      finalSession={id:'browser-session',...body,status:'completed',tokens:150,created:now,cursor:8,messages:[{...one,content:text+pausedUpdate,status:'completed'},{...two,content:report,status:'completed'}]};
      const initialEvents = [{type:'message',message:one},{type:'delta',id:one.id,text}];
      remainingEvents = [
        {type:'message_end',id:one.id,status:'completed',tokens:75},
        {type:'message',message:two},
        {type:'delta',id:two.id,text:report},
        {type:'message_end',id:two.id,status:'completed',tokens:75},
        {type:'status',status:'completed'},
      ];
      await page.route('**/api/sessions/browser-session/events?*',r=>r.fulfill({
        contentType:'text/event-stream',
        body:'retry: 60000\n\n'+initialEvents.map((p,i)=>`id: ${i+1}\ndata: ${JSON.stringify(p)}\n\n`).join(''),
      }));
      await page.route('**/api/sessions/browser-session',r=>r.fulfill({json:finalSession}));
      await route.fulfill({status:201,json:{...finalSession,status:'running',tokens:0,messages:[],cursor:0}});
    });
    await page.locator('.inspector-footer').getByRole('button',{name:'开始研讨',exact:true}).click();
    await page.locator('.message').first().waitFor();
    await page.getByText('增长 20%。',{exact:false}).first().waitFor();
    const messages = page.locator('.messages');
    await page.waitForFunction(() => {
      const list = document.querySelector('.messages');
      return list.scrollTop > 0 && list.scrollHeight - list.clientHeight - list.scrollTop < 2;
    });
    await messages.evaluate(list => { list.scrollTop = 0; });
    const resumeFollow = page.getByRole('button', {name:'回到最新',exact:true});
    await resumeFollow.waitFor();
    await page.evaluate(text => {
      window.discussionStream.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({type:'delta',id:'test-m1',text}), lastEventId:'3',
      }));
    }, pausedUpdate);
    await page.getByText(pausedUpdate, {exact:true}).waitFor();
    assert.equal(await messages.evaluate(list => list.scrollTop), 0);
    await resumeFollow.click();
    await page.evaluate(events => {
      events.forEach((event, index) => {
        window.discussionStream.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify(event), lastEventId:String(index + 4),
        }));
      });
      window.discussionStream.dispatchEvent(new MessageEvent('end'));
    }, remainingEvents);
    await page.waitForFunction(() => {
      const list = document.querySelector('.messages');
      return list.querySelector('.summary-message') && list.scrollHeight - list.clientHeight - list.scrollTop < 2;
    });

    const exportLink = page.getByRole('link',{name:'导出 Markdown',exact:true});
    assert.equal(await exportLink.getAttribute('href'), '/api/sessions/browser-session/export');
    assert.notEqual(await exportLink.getAttribute('download'), null);
    console.log('PASS: reviewing earlier messages survives streaming, follow resumes, and the Markdown link is downloadable');

    await page.locator('.citation').first().click();
    await page.getByRole('dialog').waitFor();
    assert.ok((await page.locator('.source-code .highlight').innerText()).includes('L2'));
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.locator('.tabs button').nth(1).click();
    await page.getByRole('heading',{name:'修订建议'}).waitFor();
    await page.screenshot({path:path.join(output,'03-final-report.png'),fullPage:true});
    console.log('PASS: SSE messages, report switching and original-line citation navigation');

    await page.locator('.new-btn').click();
    const before=(await context.request.get(base+'/api/bootstrap')).json();
    const beforeDocs=new Set((await before).documents.map(d=>d.id));
    await page.getByRole('button',{name:'或先看看一场示例研讨'}).click();
    await page.locator('.demo-banner').waitFor();
    const demoDocs=await (await context.request.get(base+'/api/bootstrap')).json();
    demoDocs.documents.filter(d=>!beforeDocs.has(d.id)).forEach(d=>cleanup.push(d.id));
    assert.match(await page.locator('.demo-banner').innerText(),/未调用 API/);
    await page.screenshot({path:path.join(output,'04-demo.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{window.scrollTo(0,0);const list=document.querySelector('.messages');if(list)list.scrollTop=0});
    await page.screenshot({path:path.join(output,'05-mobile.png'),fullPage:true});
    const overflow = await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,10).map(e=>e.className)}));
    assert.ok(overflow.scroll<=overflow.width, JSON.stringify(overflow));
    await page.getByRole('button',{name:'参考文件',exact:false}).click();
    await page.locator('.search-field input').fill('browser-check');
    assert.equal(await page.locator('.table-row').count(),1);
    assert.deepEqual(errors,[]);
    console.log('PASS: explicitly labelled no-API demo, mobile layout, file library and no browser exceptions');
  } finally {
    for(const id of cleanup)await context.request.delete(base+'/api/documents/'+id).catch(()=>{});
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1});
