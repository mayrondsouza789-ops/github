(() => {
  const form=document.getElementById('account-form'), status=document.getElementById('account-status');
  async function submit(mode,body={}) {
    document.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Connecting…';
    try {const r=await fetch('/api/auth/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to complete this request.');
      if(d.confirmationRequired)status.textContent='Check your email to confirm your account, then return here to sign in.';
      else location.assign('/workspace.html');
    } catch(e) {status.textContent=e.message || 'Connection interrupted. Please retry.';}
    finally {document.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  form.addEventListener('submit',e=>{e.preventDefault();const data=new FormData(form);submit(e.submitter.value,{email:data.get('email'),password:data.get('password')});});
  document.getElementById('signout').onclick=()=>submit('signout');
})();
