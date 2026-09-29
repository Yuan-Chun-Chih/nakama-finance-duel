# runtime_finance_math.go 逐行 Code Review

## 1. `calculateBpsCeil`

```go
// L1
if value <= 0 || bps <= 0 { return 0 }
// L2
return (value*bps + 9999) / 10000
```

- `L1`：名目金額或 basis points 不為正數時，費用直接是零。
- `L2`：`value*bps` 得到 basis-points 分子；加上 `9999` 後整數除以 `10000`，等同向上取整，避免整數除法少收費用。
