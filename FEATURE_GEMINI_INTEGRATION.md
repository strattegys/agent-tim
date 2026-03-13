# Feature Request: Gemini 2.5 Flash Integration

**Status**: Planned  
**Priority**: Medium  
**Estimated Effort**: 4-6 hours

## Summary

Integrate Google Gemini 2.5 Flash as the primary LLM for private DM (telegram_main) while keeping Claude 3.5 Sonnet for the public group chat (telegram_tims-room).

## Business Case

**Cost Savings:**
- Gemini 2.5 Flash: $0.075/$0.30 per million tokens (input/output)
- Claude 3.5 Sonnet: $3/$15 per million tokens
- **~40-50x cheaper** for private DM usage

**Performance:**
- 1M token context window (vs Claude's 200K)
- Fast response times
- Reliable fallback to Claude if needed

## Implementation Approach

### Model Router Pattern

Create an abstraction layer that routes requests to either Gemini or Claude based on per-group configuration stored in the database.

**Architecture:**
- New model abstraction layer in agent runner
- Support for both Gemini and Claude SDKs
- Credential proxy updated to handle both API keys
- Configuration stored in `registered_groups.model_config`

## Implementation Phases

### Phase 1: Add Gemini SDK Support (2-3 hours)

1. Install `@google/generative-ai` in `container/agent-runner/package.json`
2. Create model abstraction layer:
   - `container/agent-runner/src/model-router.ts`
   - `container/agent-runner/src/providers/gemini.ts`
   - `container/agent-runner/src/providers/claude.ts`
   - `container/agent-runner/src/providers/types.ts`
3. Update credential proxy to support Google AI API key

### Phase 2: Configure Model Selection (1-2 hours)

4. Add `model_config` field to database schema
5. Implement routing logic:
   - telegram_main (DM): Use Gemini 2.5 Flash
   - telegram_tims-room (group): Use Claude
   - Fallback: If Gemini fails, try Claude

### Phase 3: Update Environment & Deployment (1 hour)

6. Add environment variables:
   - `GOOGLE_AI_API_KEY`
   - `GEMINI_MODEL=gemini-2.5-flash`
   - `ENABLE_MODEL_FALLBACK=true`
7. Rebuild Docker container image
8. Update database configuration for telegram_main

### Phase 4: Testing & Validation (30 minutes)

9. Test Gemini integration in private DM
10. Verify fallback mechanism
11. Monitor performance and costs

## Configuration Example

**Environment (.env):**
```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
GOOGLE_AI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.5-flash
ENABLE_MODEL_FALLBACK=true
```

**Database (telegram_main):**
```json
{
  "additionalMounts": [...],
  "modelConfig": {
    "model": "gemini",
    "geminiModel": "gemini-2.5-flash",
    "fallback": "claude"
  }
}
```

**Database (telegram_tims-room):**
```json
{
  "additionalMounts": [...]
  // No modelConfig = uses Claude (default)
}
```

## Files to Modify

- `/opt/nanoclaw/container/agent-runner/package.json` - Add Gemini SDK
- `/opt/nanoclaw/container/agent-runner/src/index.ts` - Use model router
- `/opt/nanoclaw/src/credential-proxy.ts` - Support Google AI API
- `/opt/nanoclaw/container/Dockerfile` - Include new dependencies
- `/opt/nanoclaw/.env` - Add Google AI API key
- `/opt/nanoclaw/src/db.ts` - Add model_config column (optional)

## Files to Create

- `/opt/nanoclaw/container/agent-runner/src/model-router.ts`
- `/opt/nanoclaw/container/agent-runner/src/providers/gemini.ts`
- `/opt/nanoclaw/container/agent-runner/src/providers/claude.ts`
- `/opt/nanoclaw/container/agent-runner/src/providers/types.ts`

## Rollback Plan

If issues arise:
1. Update `telegram_main` model_config to `{"model": "claude"}`
2. Restart NanoClaw service
3. Private DM falls back to Claude, group chat unaffected

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Gemini API compatibility issues | Keep Claude as fallback, test thoroughly |
| Loss of Claude-specific features | Implement equivalent features in Gemini provider |
| Session/conversation continuity | Abstract session management in model router |
| Container rebuild issues | Test locally first, keep backup of working image |

## Prerequisites

- Google AI API key from https://aistudio.google.com/apikey
- Access to NanoClaw droplet (137.184.187.233)
- Backup of current working container image

## Success Criteria

- [ ] Private DM (telegram_main) uses Gemini 2.5 Flash
- [ ] Group chat (telegram_tims-room) continues using Claude
- [ ] Automatic fallback to Claude if Gemini fails
- [ ] Cost reduction of ~40-50x for private DM usage
- [ ] No degradation in response quality or features

## References

- Detailed implementation plan: `C:\Users\USER1\.windsurf\plans/gemini-integration-plan-3898db.md`
- Gemini API docs: https://ai.google.dev/gemini-api/docs
- NanoClaw architecture: `ARCHITECTURE.md`
