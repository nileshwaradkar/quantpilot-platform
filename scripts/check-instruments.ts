import { InstrumentCatalog,nearestContracts,underlyingSymbol } from '../src/instruments.js';
const catalog=new InstrumentCatalog();
for(const market of ['NIFTY','BANKNIFTY','FINNIFTY','CRUDEOIL']){
 const rows=await catalog.get(market==='CRUDEOIL'?'MCX_COM':'NSE_FO');
 const contracts=nearestContracts(rows,market,Date.now());
 if(process.argv.includes('--inspect')&&market==='CRUDEOIL'){
  const response=await fetch('https://public.fyers.in/sym_details/MCX_COM_sym_master.json');const master=await response.json();console.log(JSON.stringify({option:master[contracts[0].symbol],future:master['MCX:CRUDEOIL26NOVFUT']},null,2));continue;
 }
 console.log(JSON.stringify({market,contracts:contracts.length,expiry:contracts[0].expiry,underlying:underlyingSymbol(rows,contracts,market),lot:contracts[0].lot,tick:contracts[0].tick}));
}


