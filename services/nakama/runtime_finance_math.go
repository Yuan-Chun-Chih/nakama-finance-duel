package main

// calculateBpsCeil calculates a basis-points charge and rounds up so fees are
// never silently under-collected because of integer division.
// calculateBpsCeil 依 basis points 計算費用並向上取整，避免少收費用。
func calculateBpsCeil(value int64, bps int64) int64 {
	if value <= 0 || bps <= 0 { // 若 value 或 bps 小於等於 0，則回傳 0。
		return 0
	}
	return (value*bps + 9999) / 10000 // 計算費用並向上取整，避免少收費用。
} // 這個函式主要用於計算交易費用，例如手續費、佣金等，確保費用不會因為整數除法而少收。
