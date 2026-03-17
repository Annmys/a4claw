-- Migration: Add approval gate system
-- Created: 2026-03-17

-- Approval gates table
CREATE TABLE IF NOT EXISTS approval_gates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    gate_type VARCHAR(40) NOT NULL,
    description TEXT,
    approver_member_ids TEXT NOT NULL,
    auto_approve_conditions JSONB,
    require_all_approvers INTEGER DEFAULT 0 NOT NULL,
    timeout_hours INTEGER DEFAULT 24 NOT NULL,
    enabled INTEGER DEFAULT 1 NOT NULL,
    center_id UUID REFERENCES command_center_centers(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_gates_type ON approval_gates(gate_type);
CREATE INDEX IF NOT EXISTS idx_approval_gates_center ON approval_gates(center_id);
CREATE INDEX IF NOT EXISTS idx_approval_gates_enabled ON approval_gates(enabled);

-- Approval requests table
CREATE TABLE IF NOT EXISTS approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gate_id UUID NOT NULL REFERENCES approval_gates(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES command_center_tasks(id) ON DELETE CASCADE,
    requester_id VARCHAR(120) NOT NULL,
    requester_member_id UUID REFERENCES command_center_members(id) ON DELETE SET NULL,
    payload JSONB NOT NULL,
    status VARCHAR(30) DEFAULT 'pending' NOT NULL,
    decisions TEXT DEFAULT '[]' NOT NULL,
    requested_at TIMESTAMP DEFAULT NOW() NOT NULL,
    decided_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_gate ON approval_requests(gate_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_task ON approval_requests(task_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requester ON approval_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_expires ON approval_requests(expires_at);
