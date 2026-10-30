import { startGameServer } from './index';

void startGameServer({
  port: Number(process.env.TOKEN_GAME_PORT ?? 3001),
  host: '127.0.0.1'
}).catch(error => { console.error(error); process.exitCode = 1; });
