## PostgreSQL 查詢

先進入資料庫：

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose exec postgres psql -U postgres -d nakama
```

看20筆歷史對局：
```
select key, update_time at time zone 'Asia/Taipei' as update_time_taipei
from storage
where collection = 'tic_tac_toe_games'
order by update_time desc
limit 20;
```

看最近一次對局：
```
select
  key,
  value,
  create_time at time zone 'Asia/Taipei' as create_time_taipei,
  update_time at time zone 'Asia/Taipei' as update_time_taipei
from storage
where collection = 'tic_tac_toe_games'
order by update_time desc
limit 1;
```

```
select
  key,
  value::json->>'gameId' as game_id,
  value::json->>'winnerUserId' as winner_user_id,
  value::json->>'finishReason' as finish_reason,
  value::json->>'finishedAt' as finished_at_raw,
  create_time at time zone 'Asia/Taipei' as create_time_taipei,
  update_time at time zone 'Asia/Taipei' as update_time_taipei,
  value
from storage
where collection = 'tic_tac_toe_games'
order by update_time desc
limit 1;
```









查看最近 completed games：

```sql
select key, value, update_time
from storage
where collection = 'tic_tac_toe_games'
order by update_time desc
limit 20;
```

查看獨立戰績投影：

```sql
select key as user_id, value, update_time
from storage
where collection = 'tic_tac_toe_player_stats'
order by update_time desc
limit 20;
```

查看 append-only 稽核事件：

```sql
select key, value, update_time
from storage
where collection = 'tic_tac_toe_events'
order by update_time desc
limit 100;
```

查看玩家歷史索引 key：

```sql
select user_id, key, update_time
from storage
where collection = 'tic_tac_toe_player_history'
order by user_id, key
limit 100;
```

查看特定 game 的事件序列：

```sql
select key, value
from storage
where collection = 'tic_tac_toe_events'
and key like '<game_id>:%'
order by key;
```
