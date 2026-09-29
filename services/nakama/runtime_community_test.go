package main

import "testing"

// TestGuildRoleAuthorization 驗證 roster state 的管理與 owner 權限邊界。
func TestGuildRoleAuthorization(t *testing.T) {
	tests := []struct {
		name      string
		state     int32
		canManage bool
		isOwner   bool
	}{
		{name: "owner", state: 0, canManage: true, isOwner: true},
		{name: "admin", state: 1, canManage: true, isOwner: false},
		{name: "member", state: 2, canManage: false, isOwner: false},
		{name: "join request", state: 3, canManage: false, isOwner: false},
		{name: "missing", state: -1, canManage: false, isOwner: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := guildStateCanManage(test.state); got != test.canManage {
				t.Fatalf("guildStateCanManage(%d) = %t, want %t", test.state, got, test.canManage)
			}
			if got := guildStateIsOwner(test.state); got != test.isOwner {
				t.Fatalf("guildStateIsOwner(%d) = %t, want %t", test.state, got, test.isOwner)
			}
		})
	}
}

// TestGuildPromotionsToOwner 驗證角色轉移只執行必要的 promote 次數。
func TestGuildPromotionsToOwner(t *testing.T) {
	tests := []struct { // 
		state int32
		want  int
	}{
		{state: 0, want: 0},
		{state: 1, want: 1},
		{state: 2, want: 2},
	}
	for _, test := range tests {
		got, err := guildPromotionsToOwner(test.state)
		if err != nil || got != test.want {
			t.Fatalf("guildPromotionsToOwner(%d) = %d, %v; want %d, nil", test.state, got, err, test.want)
		}
	}
	if _, err := guildPromotionsToOwner(3); err == nil {
		t.Fatal("join-request state was accepted as an active guild member")
	}
}

// TestGuildOperationKeySupportsExplicitIdempotency 驗證 client operation ID 可穩定重建相同 key。
func TestGuildOperationKeySupportsExplicitIdempotency(t *testing.T) {
	first := buildGuildOperationKey("owner_transfer", "guild", "actor", "target", "request-123")
	second := buildGuildOperationKey("owner_transfer", "guild", "actor", "target", "request-123")
	if first != second || first != "guild:owner_transfer:request-123" {
		t.Fatalf("operation keys = %q and %q", first, second)
	}
	legacy := buildGuildOperationKey("owner_transfer", "guild", "actor", "target", "")
	if legacy != "guild:owner_transfer:actor:target" {
		t.Fatalf("legacy operation key = %q", legacy)
	}
}
