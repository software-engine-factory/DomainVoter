// Retry the caller's entire transaction closure after better-sqlite3 rolls it back.
export async function retryBusy(fn,{onRetry=()=>{},deadlineMs=5000,delayMs=5}={}) {
  const deadline=performance.now()+deadlineMs;
  for(;;)try{return fn();}catch(e){
    if(!e.code?.startsWith('SQLITE_BUSY')||performance.now()>=deadline)throw e;
    onRetry(e.code);
    await new Promise(resolve=>setTimeout(resolve,delayMs));
  }
}
