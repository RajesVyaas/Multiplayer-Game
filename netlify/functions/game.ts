import { getStore } from '@netlify/blobs';
import type { Handler } from '@netlify/functions';
import { QUESTIONS, type Question } from '../../shared/questions';

type Player = { id:string; name:string; avatar:string; score:number; ready:boolean; connectedAt:number; correctByRound:number[] };
type Game = { code:string; hostId:string; status:'lobby'|'playing'|'finished'; players:Player[]; round:number; questionIndex:number; questionStartedAt:number; deadline:number; answers:Record<string,number>; questions:Question[]; version:number; transitionAt:number; winnerId?:string };
const store = getStore({ name:'quiz-battle-rooms', consistency:'strong' });
const avatars=['🦊','🐼','🦁','🐸','🐯','🐙','🦄','🐨'];
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const shuffle=<T,>(items:T[])=>{const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const makeCode=()=>Math.random().toString(36).slice(2,8).toUpperCase().replace(/[IO01]/g,'Z');
const scoreFor=(ms:number)=>ms<=5000?1000:ms<=10000?750:ms<=15000?500:ms<=20000?250:0;
async function read(code:string){return store.getWithMetadata(`room:${code}`,{type:'json',consistency:'strong'}) as Promise<{data:Game;etag:string}|null>;}
async function update(code:string,mutate:(g:Game)=>void){
  for(let attempt=0;attempt<8;attempt++){
    const current=await read(code);if(!current)throw new Error('Room not found. Check the code.');
    const g=current.data;mutate(g);g.version++;
    const saved=await store.setJSON(`room:${code}`,g,{onlyIfMatch:current.etag});
    if(saved.modified)return g;
  }
  throw new Error('This room is receiving too many actions. Please try again.');
}
function publicView(g:Game,playerId:string,now=Date.now()){
  const q=g.status==='playing'?g.questions[g.questionIndex]:undefined;
  const {questions,...safe}=g;
  return {...safe,currentQuestion:q?{category:q.category,difficulty:q.difficulty,en:q.en,hi:q.hi,options:q.options}:undefined,you:playerId,isHost:g.hostId===playerId,serverNow:now};
}
function progress(g:Game,now:number){
  if(g.status!=='playing')return;
  const allAnswered=g.players.length>0&&g.players.every(p=>g.answers[p.id]!==undefined);
  const due=now>=g.deadline;
  const readyToAdvance=allAnswered&&now>=g.transitionAt;
  if(!due&&!readyToAdvance)return;
  if(g.questionIndex>=29){
    for(const p of g.players){if(p.correctByRound[2]===10)p.score+=500;}
    g.status='finished';g.winnerId=[...g.players].sort((a,b)=>b.score-a.score)[0]?.id;return;
  }
  const previousRound=Math.floor(g.questionIndex/10),nextIndex=g.questionIndex+1,nextRound=Math.floor(nextIndex/10);
  if(nextRound>previousRound){for(const p of g.players){if(p.correctByRound[previousRound]===10)p.score+=500;}}
  g.questionIndex=nextIndex;g.round=Math.floor(nextIndex/10)+1;g.answers={};g.questionStartedAt=now;g.deadline=now+20000;g.transitionAt=0;
}
const handler:Handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'}};
  if(event.httpMethod!=='POST')return {statusCode:405,body:JSON.stringify({error:'Use POST.'})};
  try{
    const body=JSON.parse(event.body||'{}') as {action:string;playerId:string;name?:string;code?:string;answer?:number;language?:string};
    const {action,playerId}=body;if(!playerId||typeof playerId!=='string')return {statusCode:400,body:JSON.stringify({error:'Player identity is missing.'})};
    if(action==='create'){
      if(!body.name?.trim())return {statusCode:400,body:JSON.stringify({error:'Enter a display name.'})};
      let code='',game:Game|undefined;
      for(let i=0;i<5;i++){code=makeCode();const candidate:Game={code,hostId:playerId,status:'lobby',players:[{id:playerId,name:body.name.trim().slice(0,18),avatar:avatars[Math.floor(Math.random()*avatars.length)],score:0,ready:true,connectedAt:Date.now(),correctByRound:[0,0,0]}],round:1,questionIndex:0,questionStartedAt:0,deadline:0,answers:{},questions:[...shuffle(QUESTIONS.filter(q=>q.difficulty==='easy')).slice(0,10),...shuffle(QUESTIONS.filter(q=>q.difficulty==='medium')).slice(0,10),...shuffle(QUESTIONS.filter(q=>q.difficulty==='hard')).slice(0,10)],version:1,transitionAt:0};const result=await store.setJSON(`room:${code}`,candidate,{onlyIfNew:true});if(result.modified){game=candidate;break;}}
      if(!game)throw new Error('Could not create a room. Please try again.');return {statusCode:200,body:JSON.stringify(publicView(game,playerId))};
    }
    if(!body.code)return {statusCode:400,body:JSON.stringify({error:'Room code is required.'})};const code=body.code.toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(action==='join'){
      if(!body.name?.trim())throw new Error('Enter a display name.');
      const g=await update(code,room=>{if(room.status!=='lobby')throw new Error('This game has already started. Rooms lock when the host starts.');if(room.players.some(p=>p.id===playerId))return;if(room.players.length>=8)throw new Error('This room is full (8 players maximum).');room.players.push({id:playerId,name:body.name!.trim().slice(0,18),avatar:avatars[room.players.length%avatars.length],score:0,ready:true,connectedAt:Date.now(),correctByRound:[0,0,0]});});return {statusCode:200,body:JSON.stringify(publicView(g,playerId))};
    }
    if(action==='state'){
      let current=await read(code);if(!current)throw new Error('Room not found. Check the code.');
      if(current.data.status==='playing'){
        const now=Date.now();const all=current.data.players.every(p=>current!.data.answers[p.id]!==undefined);
        if(now>=current.data.deadline||(all&&now>=current.data.transitionAt)){const g=await update(code,room=>progress(room,now));return {statusCode:200,body:JSON.stringify(publicView(g,playerId,now))};}
      }
      if(!current.data.players.some(p=>p.id===playerId))throw new Error('You are not a member of this room.');return {statusCode:200,body:JSON.stringify(publicView(current.data,playerId))};
    }
    if(action==='start'){
      const g=await update(code,room=>{if(room.hostId!==playerId)throw new Error('Only the host can start the game.');if(room.status!=='lobby')throw new Error('The game has already started.');if(room.players.length<2)throw new Error('At least 2 players are required.');room.status='playing';room.round=1;room.questionIndex=0;room.questionStartedAt=Date.now();room.deadline=Date.now()+20000;room.answers={};});return {statusCode:200,body:JSON.stringify(publicView(g,playerId))};
    }
    if(action==='answer'){
      if(!Number.isInteger(body.answer)||body.answer!<0||body.answer!>3)throw new Error('Choose one of the four answers.');
      const g=await update(code,room=>{if(room.status!=='playing')throw new Error('This question is no longer active.');const p=room.players.find(x=>x.id===playerId);if(!p)throw new Error('You are not in this room.');if(Date.now()>room.deadline)throw new Error('Time is up for this question.');if(room.answers[playerId]!==undefined)throw new Error('Your answer is already locked.');room.answers[playerId]=body.answer!;const q=room.questions[room.questionIndex];if(body.answer===q.answer){const points=scoreFor(Date.now()-room.questionStartedAt);p.score+=points;p.correctByRound[room.round-1]++;}const all=room.players.every(x=>room.answers[x.id]!==undefined);if(all)room.transitionAt=Date.now()+1200;});return {statusCode:200,body:JSON.stringify(publicView(g,playerId))};
    }
    if(action==='rematch'){
      const g=await update(code,room=>{if(room.hostId!==playerId)throw new Error('Only the host can start a rematch.');if(room.status!=='finished')throw new Error('The current game is not finished.');room.status='lobby';room.round=1;room.questionIndex=0;room.questionStartedAt=0;room.deadline=0;room.transitionAt=0;room.answers={};room.winnerId=undefined;room.questions=[...shuffle(QUESTIONS.filter(q=>q.difficulty==='easy')).slice(0,10),...shuffle(QUESTIONS.filter(q=>q.difficulty==='medium')).slice(0,10),...shuffle(QUESTIONS.filter(q=>q.difficulty==='hard')).slice(0,10)];for(const p of room.players){p.score=0;p.correctByRound=[0,0,0];}});return {statusCode:200,body:JSON.stringify(publicView(g,playerId))};
    }
    throw new Error('Unknown action.');
  }catch(error){const message=error instanceof Error?error.message:'Unexpected server error.';return {statusCode:400,headers:{'Content-Type':'application/json'},body:JSON.stringify({error:message})};}
};
export { handler };
