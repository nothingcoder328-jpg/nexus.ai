require('dotenv').config();
const express=require('express');
const app=express();
app.use(express.json());
app.use(express.static('public'));
app.get('/api/balance',async(req,res)=>{try{const r=await fetch('https://beta-api.paywithlocus.com/api/pay/balance',{headers:{'Authorization':'Bearer '+process.env.LOCUS_API_KEY}});res.json(await r.json());}catch(e){res.json({error:e.message});}});
app.get('/api/status',(req,res)=>res.json({status:'alive'}));
app.listen(3000,'0.0.0.0',()=>process.stdout.write('RUNNING\n'));