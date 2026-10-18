/* Website requests are visible only to authenticated administrators. */
(() => {
  let requests = [], unsubscribe = null, currentUid = null, requestError = false;
  const busy = new Set();
  function accounts() {
    const result=new Map(Object.entries(cloud.users||{}).filter(([,u])=>u.email));
    if(cloud.user) result.set(cloud.user.uid,{...(result.get(cloud.user.uid)||{}),email:cloud.user.email});
    return result;
  }
  function accountOptions(selected='') {
    return '<option value="">Elige una cuenta del equipo</option>'+[...accounts()].map(([uid,u])=>`<option value="${esc(uid)}" ${uid===selected?'selected':''}>${esc(nameOf(u.email))}${ADMINS.includes(String(u.email).toLowerCase())?' · Administrador':''}${uid===cloud.user.uid?' · Mi cuenta':''}</option>`).join('');
  }
  function scheduleDates(values) {
    if(values.plan==='custom') {
      const dates=[...new Set(values.dates||[])].sort();
      if(!dates.length)throw new Error('days');
      if(dates.length>62||dates.some(date=>!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(new Date(date+'T12:00:00').getTime())||localDate(new Date(date+'T12:00:00'))!==date))throw new Error('invalid');
      return dates;
    }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(values.date||'')) throw new Error('invalid');
    const start=new Date(values.date+'T12:00:00');
    if(!Number.isFinite(start.getTime())||localDate(start)!==values.date) throw new Error('invalid');
    const period=values.plan||'once';
    if(!['once','week','fortnight','month'].includes(period)) throw new Error('invalid');
    if(period==='once')return [values.date];
    let end=new Date(start);
    if(period==='month') {
      const last=new Date(start.getFullYear(),start.getMonth()+2,0).getDate();
      end=new Date(start.getFullYear(),start.getMonth()+1,Math.min(start.getDate(),last),12);
      end.setDate(end.getDate()-1);
    } else end.setDate(end.getDate()+(period==='week'?6:14));
    const selected=new Set((values.days||[]).map(Number));
    const dates=[];
    for(let day=new Date(start);day<=end;day.setDate(day.getDate()+1)) if(selected.has(day.getDay()))dates.push(localDate(day));
    if(!dates.length)throw new Error('days');
    return dates;
  }
  const originalUsersSnap=onUsersSnap;
  onUsersSnap=function(snapshot){originalUsersSnap(snapshot);document.querySelectorAll('.web-request-form select[name=assignee]').forEach(select=>{const value=select.value;select.innerHTML=accountOptions(value);});};
  function replyLink(r) {
    let phone = String(r.phone || '').replace(/\D/g, '');
    if(phone.startsWith('00')) phone=phone.slice(2);
    if(/^9\d{8}$/.test(phone)) phone='56'+phone;
    if(!/^[1-9]\d{7,14}$/.test(phone)) return null;
    const message=`Hola ${r.owner}, soy ${r.walker} de Patitas en Ruta. Recibimos tu solicitud de ${String(r.service).toLowerCase()} para ${r.dog}, el ${r.date} (${r.period}), en ${r.area}. Te escribo para coordinar los detalles y revisar la disponibilidad.`;
    return 'https://wa.me/'+phone+'?text='+encodeURIComponent(message);
  }
  const originalRender = render;
  render = function () { originalRender(); showRequests(); };
  const originalStart = cloudStart;
  cloudStart = function (done) { originalStart(done); startRequests(); };
  const originalStop = cloudStop;
  cloudStop = function () { if(unsubscribe) unsubscribe(); unsubscribe=null; requests=[]; currentUid=null; originalStop(); };
  function startRequests() {
    if (!cloud.admin || !cloud.user || currentUid === cloud.user.uid) return;
    currentUid = cloud.user.uid;
    unsubscribe = cloud.fs.collection('bookingRequests').where('status','==','pending').onSnapshot(snapshot => {
      requestError = false;
      requests = snapshot.docs.map(d => ({...d.data(), id:d.id})).sort((a,b) => a.date.localeCompare(b.date));
      showRequests();
    }, () => { requestError = true; showRequests(); });
  }
  function showRequests() {
    document.getElementById('webRequests')?.remove();
    if (!cloud.admin || !cloud.user || !['home','agenda'].includes(view)) return;
    const panel = document.createElement('section'); panel.id='webRequests'; panel.className='panel';
    panel.innerHTML = `<h2>📩 Solicitudes desde la web ${requests.length ? '('+requests.length+')' : ''}</h2>
      <p class="hint">Pendientes de confirmar. No generan cobros ni reservan horarios hasta que las aceptes.</p>`;
    if (requestError) panel.insertAdjacentHTML('beforeend','<p class="hint">No se pudieron consultar las solicitudes. Revisa la conexión y los permisos.</p>');
    else if (!requests.length) panel.insertAdjacentHTML('beforeend','<p class="hint">Todavía no hay solicitudes pendientes.</p>');
    for (const r of requests) {
      const card=document.createElement('article'); card.className='walk';
      card.innerHTML=`<strong>${esc(r.dog)} · ${esc(r.service)}</strong><p class="hint">${esc(r.owner)} · ${esc(r.phone)}<br>${esc(r.area)} · ${esc(r.walker)}<br>Fecha solicitada: ${esc(r.date)} · ${esc(r.period)}</p>
      <details><summary style="cursor:pointer;padding:10px 0">Revisar y confirmar</summary><form class="web-request-form" style="display:grid;gap:8px;margin-top:10px">
      <label>Asignar a<select name="assignee" required>${accountOptions()}</select></label>
      <p class="hint">Puedes elegir cualquier cuenta registrada, incluidos los administradores.</p>
      <label>Cómo elegir las fechas<select name="plan">${r.service==='Hotel'?'':'<option value="custom">Fechas a elección</option>'}<option value="once">Un solo servicio</option>${r.service==='Hotel'?'':'<option value="week">Una semana (7 días)</option><option value="fortnight">Quince días</option><option value="month">Un mes desde la fecha de inicio</option>'}</select></label>
      <label class="request-start-date">Fecha de inicio<input name="date" type="date" value="${esc(r.date)}" required></label>
      <details class="request-calendar-toggle" ${r.service==='Hotel'?'hidden':''}><summary>Marcar fechas en el calendario <span>▾</span></summary><div class="request-calendar"></div></details>
      <fieldset class="request-weekdays" hidden style="border:1px solid #e6dba9;border-radius:12px;padding:12px"><legend>Días de paseo</legend><div style="display:flex;flex-wrap:wrap;gap:10px">${[[1,'Lun'],[2,'Mar'],[3,'Mié'],[4,'Jue'],[5,'Vie'],[6,'Sáb'],[0,'Dom']].map(([n,label])=>`<label style="display:flex;align-items:center;gap:5px;min-height:40px"><input type="checkbox" style="width:18px;height:18px;min-height:0" name="days" value="${n}" ${n===new Date(r.date+'T12:00:00').getDay()?'checked':''}>${label}</label>`).join('')}</div></fieldset>
      <label>Hora acordada<input name="time" type="time" required></label>
      <label>Duración en minutos<input name="minutes" type="number" min="1" max="1440" value="60" required></label>
      <label>Precio por ${r.service==='Hotel'?'noche':'servicio'} ($)<input name="price" type="number" min="0" step="1" required></label>
      ${r.service==="Hotel"?`<label>Noches acordadas<input name="nights" type="number" min="1" max="365" value="1" required></label>`:""}<p class="hint request-plan-summary" role="status"></p><p class="hint">Se guardarán las fechas en la agenda de la cuenta que elijas. Coordina con el cliente antes de confirmar.</p>
      <button type="submit" class="btn">Confirmar y agendar</button></form></details>
      <button type="button" class="btn secondary small request-decline" style="margin-top:10px">No aceptar solicitud</button><p class="hint web-request-status" role="status"></p>`;
      const whatsapp=replyLink(r);
      if(whatsapp) {
        const link=document.createElement('a');
        link.href=whatsapp; link.target='_blank'; link.rel='noopener noreferrer';
        link.className='btn small';
        link.style.cssText='display:inline-flex;align-items:center;gap:8px;background:#25d366;color:#123b24;text-decoration:none;margin:0 0 8px;min-height:44px;max-width:100%;box-sizing:border-box';
        link.setAttribute('aria-label','Responder a '+r.owner+' por WhatsApp como '+r.walker);
        link.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.7a8.5 8.5 0 1 1 16.2-4.1Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 7.5c-2 2 3.4 8.2 6.5 8 1.1-.1 2-1.5 1.3-2l-2-1-1 1c-1.4-.6-2.7-1.8-3.3-3.2l.8-1.1-1-1.9c-.3-.4-.8-.2-1.3.2Z" fill="currentColor"/></svg><span>Responder por WhatsApp ↗</span>';
        card.insertBefore(link,card.querySelector('details'));
        const hint=document.createElement('p'); hint.className='hint'; hint.style.margin='0 0 12px';
        hint.textContent='Mensaje preparado para '+r.walker+'. Se abre desde el WhatsApp de quien responda; podrás revisarlo antes de enviarlo.';
        card.insertBefore(hint,card.querySelector('details'));
      }
      const form=card.querySelector('form');
      const chosenDates=new Set([r.date]);
      let calendarMonth=new Date(r.date+'T12:00:00');calendarMonth.setDate(1);
      const calendar=form.querySelector('.request-calendar');
      const readValues=()=>{const fields=new FormData(form);return {...Object.fromEntries(fields),days:fields.getAll('days'),dates:[...chosenDates]};};
      const preview=()=>{
        const mode=form.elements.plan.value;
        form.querySelector('.request-weekdays').hidden=['once','custom'].includes(mode);
        form.querySelector('.request-calendar-toggle').hidden=mode!=='custom';
        form.querySelector('.request-start-date').hidden=mode==='custom';
        form.elements.date.required=mode!=='custom';
        const line=form.querySelector('.request-plan-summary');
        try{
          const dates=scheduleDates(readValues());
          const units=r.service==='Hotel'?Math.max(1,+form.elements.nights.value||1):dates.length;
          const total=units*(+form.elements.price.value||0);
          line.textContent=`${dates.length} servicio(s): del ${dates[0]} al ${dates[dates.length-1]}. Total acordado: ${money(total)}.`;
          const account=accounts().get(form.elements.assignee.value);
          if(account){
            const admin=ADMINS.includes(String(account.email).toLowerCase());
            const source=form.elements.assignee.value===cloud.user.uid?cloud.selfJson:account.json;
            const targetData=normalizedDb(JSON.parse(source||'{}'));
            const rate=admin?0:Math.max(0,+targetData.commissionByService[r.service==='Guardería'?'Pet sitter':r.service]||0);
            const commission=units*rate;
            line.textContent+=admin?' Administrador: sin comisión.':` Comisión: ${money(commission)}. Neto para el paseador: ${money(total-commission)}.`;
          }
        }catch{line.textContent='Selecciona al menos una fecha o un día de paseo.';}
      };
      const drawCalendar=()=>{
        const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth();
        const offset=(new Date(year,month,1,12).getDay()+6)%7;
        const length=new Date(year,month+1,0,12).getDate();
        let cells='<span aria-hidden="true"></span>'.repeat(offset);
        for(let day=1;day<=length;day++) {
          const date=localDate(new Date(year,month,day,12));
          cells+=`<button type="button" data-pick-date="${date}" aria-label="${esc(new Date(year,month,day,12).toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}" aria-pressed="${chosenDates.has(date)}">${day}</button>`;
        }
        calendar.innerHTML=`<p class="hint" style="margin:0 0 10px">Marca los días acordados. Toca de nuevo una fecha para quitarla; puedes cambiar de mes.</p><div class="request-calendar-head"><button type="button" class="btn secondary small" data-month="-1" aria-label="Mes anterior">‹</button><strong>${esc(calendarMonth.toLocaleDateString('es-CL',{month:'long',year:'numeric'}))}</strong><button type="button" class="btn secondary small" data-month="1" aria-label="Mes siguiente">›</button></div><div class="request-calendar-grid">${['L','M','X','J','V','S','D'].map(d=>`<span class="request-calendar-weekday" aria-hidden="true">${d}</span>`).join('')}${cells}</div><p class="hint" style="overflow-wrap:anywhere">${chosenDates.size} fecha(s): ${esc([...chosenDates].sort().map(d=>d.split('-').reverse().join('/')).join(', '))}</p><button type="button" class="btn secondary small" data-clear-dates>Limpiar selección</button>`;
      };
      calendar.addEventListener('click',event=>{
        const button=event.target.closest('button');if(!button||!calendar.contains(button))return;
        if(button.dataset.month){calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+Number(button.dataset.month),1,12);drawCalendar();}
        if(button.dataset.pickDate){const date=button.dataset.pickDate;if(chosenDates.has(date))chosenDates.delete(date);else if(chosenDates.size<62)chosenDates.add(date);else{toast('Puedes elegir hasta 62 fechas por solicitud.');return;}drawCalendar();preview();}
        if(button.hasAttribute('data-clear-dates')){chosenDates.clear();drawCalendar();preview();}
      });
      drawCalendar();
      form.addEventListener('change',preview);form.addEventListener('input',preview);preview();
      form.addEventListener('submit', e=>{e.preventDefault();handle(r,card,'confirmed',readValues());});
      card.querySelector('.request-decline').addEventListener('click',()=>{if(confirm('¿Marcar esta solicitud como no aceptada?'))handle(r,card,'declined');});
      panel.append(card);
    }
    document.getElementById('content').prepend(panel);
  }
  async function handle(r,card,status,values={}) {
    if (busy.has(r.id) || !cloud.admin || !cloud.user) return;
    busy.add(r.id); card.querySelectorAll('button').forEach(b=>b.disabled=true);
    const message=card.querySelector('.web-request-status');
    try {
      // Flush unrelated edits before reading and merging the authoritative record.
      await flushAll();
      const uid=cloud.user.uid, email=cloud.user.email;
      const target=status==='confirmed'?values.assignee:uid;
      if(status==='confirmed'&&!accounts().has(target))throw new Error('assignee');
      const dates=status==='confirmed'?scheduleDates(values):[];
      const requestRef=cloud.fs.collection('bookingRequests').doc(r.id);
      const userRef=cloud.fs.collection('users').doc(target);
      await cloud.fs.runTransaction(async tx=>{
        const requestSnap=await tx.get(requestRef);
        const userSnap=status==='confirmed' ? await tx.get(userRef) : null;
        if(!requestSnap.exists || requestSnap.data().status!=='pending') throw new Error('handled');
        const request=requestSnap.data();
        const handled={status,handledAt:firebase.firestore.FieldValue.serverTimestamp(),handledBy:uid};
        if(status==='confirmed') {
          if(!/^\d{4}-\d{2}-\d{2}$/.test(values.date)||!/^\d{2}:\d{2}$/.test(values.time)
            ||!Number.isFinite(+values.price)||+values.price<0||!Number.isFinite(+values.minutes)||+values.minutes<1||+values.minutes>1440||(request.service==="Hotel"&&(!Number.isInteger(+values.nights)||+values.nights<1||+values.nights>365))) throw new Error('invalid');
          const data=normalizedDb(JSON.parse(userSnap?.data()?.json||'{}'));
          let customer=data.clients.find(c=>c.phone===request.phone && c.owner===request.owner);
          if(!customer) {
            customer={id:'web-client:'+r.id,owner:request.owner,phone:request.phone,area:request.area,address:'',unit:'',dogs:[request.dog],monthlyFee:0,monthlyWalks:0,noCommission:ADMINS.includes(String(accounts().get(target).email).toLowerCase()),note:'Solicitud web'};
            data.clients.push(customer);
          } else if(!customer.dogs.includes(request.dog)) customer.dogs.push(request.dog);
          const assignedEmail=accounts().get(target).email;
          const assignedAdmin=ADMINS.includes(String(assignedEmail).toLowerCase());
          const commissionRate=assignedAdmin?0:Math.max(0,+data.commissionByService[request.service==='Guardería'?'Pet sitter':request.service]||0);
          for(const date of dates) {
          const id='web-walk:'+r.id+':'+date;
          const duplicate=data.walks.some(w=>w.id===id||(w.status!=='Cancelado'&&w.clientId===customer.id&&w.dog===request.dog&&w.date===date&&w.time===values.time&&w.service===(request.service==='Guardería'?'Pet sitter':request.service)));
          if(!duplicate) data.walks.push({id,clientId:customer.id,dog:request.dog,date,time:values.time,
            service:request.service==='Guardería'?'Pet sitter':request.service,nights:request.service==="Hotel"?+values.nights:1,minutes:+values.minutes,price:+values.price,
            status:'Agendado',paid:false,commissionExempt:assignedAdmin,commissionRate,note:'Solicitud web · Asignado a: '+nameOf(assignedEmail)+' · Paseadora solicitada: '+request.walker,bookingRequestId:r.id});
          }
          tx.set(userRef,{json:JSON.stringify(data),updatedAt:Date.now(),by:email,email:assignedEmail},{merge:true});
          handled.walkId='web-walk:'+r.id+':'+dates[0];
        }
        tx.update(requestRef,handled);
      });
      toast(status==='confirmed'?dates.length+' servicio(s) agendados en la cuenta seleccionada.':'Solicitud marcada como no aceptada.');
    } catch(error) {
      message.textContent=error.message==='handled'?'Esta solicitud ya fue atendida. Actualiza la página.':error.message==='days'?'Elige al menos un día de paseo.':error.message==='assignee'?'Elige una cuenta del equipo.':'No se pudo guardar. La solicitud sigue pendiente; inténtalo de nuevo.';
      card.querySelectorAll('button').forEach(b=>b.disabled=false);
    } finally {busy.delete(r.id);}
  }
  if(cloud.user) startRequests();
})();
