# Security Workflows, Edge Cases and Acceptance Criteria

## Login

```
Enter username + password/PIN → account exists? → locked? → credentials ok?
  no  → record attempt, count failure, lock at 5, return generic error
  yes → account active? → create session (end older ones) → load permissions
      → audit LOGIN → open dashboard for role (force change if mustChange)
```

## Authorization (every request, in order)

1. Token present and session valid (not revoked, not idle/expired)?
2. User still `active`?
3. Role permissions loaded fresh from the database.
4. User holds the permission code? (else 403)
5. Scope fits the record (own / branch / all)?
6. Numeric limit respected? If not, approval required.
7. Business action runs, then the audit record is written.

## Over-limit approval

```
Cashier action above limit → 403 APPROVAL_REQUIRED
→ Cashier requests approval (reason) → Manager approves or rejects
→ Cashier retries with approvalId → approval marked used → action allowed → audit with approver
```

## Deactivate a user

```
Manager/Admin gives reason → not self, not last admin → (check open shift/orders)
→ status inactive → all sessions revoked → audit USER_DEACTIVATED
```

## Edge cases

| Scenario | Expected behaviour |
|---|---|
| 5 wrong PINs | Account locks; manager unlocks; both audited |
| Forgotten PIN | Manager resets; user must change at next login |
| User deactivated while logged in | Next request returns 401; session revoked |
| Role changed during a session | New permissions apply on the next request |
| Two people share one login | One session per user; newer login ends the older |
| Approver unavailable | Request stays pending; action is not allowed without it |
| User approves own request | Rejected (`SELF_APPROVAL`) |
| Approval reused | Rejected; approvals are single-use |
| Approver's limit lower than the amount | Rejected; escalate to higher role |
| Session expires mid-payment | Payment is not lost; user logs in and continues |
| Offline login | Depends on offline design (open question) |
| Cross-branch access | 403 and audited |
| Last admin deactivated or demoted | Blocked (`LAST_ADMIN`) |
| Manager grants Admin role | Blocked (`PRIVILEGE_ESCALATION`) |
| User edits own roles | Blocked |
| Attempt to edit or delete audit rows | Database refuses |
| Same user on two terminals | Older session is ended |

## Acceptance criteria

- Given a Waiter, when they request a refund, then the system returns 403 and nothing changes.
- Given a Cashier with a 10% limit, when they apply 20% without approval, then the system returns `APPROVAL_REQUIRED`.
- Given an approved request, when the cashier uses it once, then the discount is allowed; when they use it again, then it is refused.
- Given 5 failed logins, then the account is locked and the event is audited.
- Given a deactivated user with an open session, when they call any endpoint, then they get 401.
- Given an order cancelled after KOT, then the audit log shows who, when, old value, new value and reason.
- Given each role logs in, then they see only the dashboard widgets they have permission for.
- Given a Manager, when they assign the Admin role, then the system refuses.
- Given any audit row, when anyone tries to change or delete it, then the database refuses.
- Given a manager in branch A, when they open a user in branch B, then they get 403.
