/* Website requests are visible only to authenticated administrators. */
(() => {
  let requests = [], unsubscribe = null, currentUid = null, requestError = false;
  const busy = new Set();
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
      <details><summary style="cursor:pointer;padding:10px 0">Revisar y confirmar</summary><form class="web-request-form" style="display:grid;gap:10px;margin-top:10px">
      <label>Fecha acordada<input name="date" type="date" value="${esc(r.date)}" required></label>
      <label>Hora acordada<input name="time" type="time" required></label>
      <label>Duración en minutos<input name="minutes" type="number" min="1" max="1440" value="60" required></label>
      <label>Precio acordado ($)<input name="price" type="number" min="0" step="1" required></label>
      ${r.service==="Hotel"?`<label>Noches acordadas<input name="nights" type="number" min="1" max="365" value="1" required></label>`:""}<p class="hint">Se agregará a la agenda de tu cuenta. La paseadora solicitada quedará anotada en el servicio. Confirma los detalles con el cliente antes de aceptar.</p>
      <button type="submit" class="btn">Confirmar y agregar a mi agenda</button></form></details>
      <button type="button" class="btn secondary small" style="margin-top:10px">No aceptar solicitud</button><p class="hint web-request-status" role="status"></p>`;
      card.querySelector('form').addEventListener('submit', e=>{e.preventDefault();handle(r,card,'confirmed',Object.fromEntries(new FormData(e.target)));});
      card.querySelector('button[type=button]').addEventListener('click',()=>{if(confirm('¿Marcar esta solicitud como no aceptada?'))handle(r,card,'declined');});
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
      const requestRef=cloud.fs.collection('bookingRequests').doc(r.id);
      const userRef=cloud.fs.collection('users').doc(uid);
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
            customer={id:'web-client:'+r.id,owner:request.owner,phone:request.phone,area:request.area,address:'',unit:'',dogs:[request.dog],monthlyFee:0,monthlyWalks:0,noCommission:false,note:'Solicitud web'};
            data.clients.push(customer);
          } else if(!customer.dogs.includes(request.dog)) customer.dogs.push(request.dog);
          const id='web-walk:'+r.id;
          if(!data.walks.some(w=>w.id===id)) data.walks.push({id,clientId:customer.id,dog:request.dog,date:values.date,time:values.time,
            service:request.service==='Guardería'?'Pet sitter':request.service,nights:request.service==="Hotel"?+values.nights:1,minutes:+values.minutes,price:+values.price,
            status:'Agendado',paid:false,note:'Solicitud web · Paseadora solicitada: '+request.walker,bookingRequestId:r.id});
          tx.set(userRef,{json:JSON.stringify(data),updatedAt:Date.now(),by:email,email},{merge:true});
          handled.walkId=id;
        }
        tx.update(requestRef,handled);
      });
      toast(status==='confirmed'?'Solicitud agregada a tu agenda.':'Solicitud marcada como no aceptada.');
    } catch(error) {
      message.textContent=error.message==='handled'?'Esta solicitud ya fue atendida. Actualiza la página.':'No se pudo guardar. La solicitud sigue pendiente; inténtalo de nuevo.';
      card.querySelectorAll('button').forEach(b=>b.disabled=false);
    } finally {busy.delete(r.id);}
  }
  if(cloud.user) startRequests();
})();
