# Tim's Model Selection Guide

Tim has access to multiple AI models through the same Gemini API key. Each model has different strengths.

## Available Models

### 1. Gemini 3.1 Flash Lite Preview (Default - Fast)
**Model**: `gemini/gemini-3.1-flash-lite-preview`

**Best for**:
- Quick responses
- Simple queries
- General conversation
- CRM operations
- Tool usage
- Most day-to-day tasks

**Characteristics**:
- Very fast response time
- Cost-effective
- Good for most tasks
- 8K max tokens
- Latest Gemini 3.1 generation

### 2. Gemini 3.1 Pro Preview (Pro)
**Model**: `gemini/gemini-3.1-pro-preview`

**Best for**:
- Complex reasoning
- Multi-step problem solving
- Analysis and planning
- Code review
- Strategic thinking
- Critical decisions
- Long-form content

**Characteristics**:
- Highest capability
- Best reasoning
- More thorough responses
- Latest Gemini 3.1 Pro model

### 4. Groq Llama 3.1 70B (Ultra Fast)
**Model**: `groq/llama-3.1-70b-versatile`

**Best for**:
- Extremely fast responses needed
- Simple queries
- High-volume tasks
- When speed is critical

**Characteristics**:
- 500+ tokens/sec
- Very fast
- Good for simple tasks
- Different API (Groq)

## Current Configuration

**Default Model**: Gemini 2.0 Flash Exp
**Max Tokens**: 8192
**Temperature**: 0.7
**Memory Window**: 50 messages

## Model Routing Strategy

Tim should use:

1. **Gemini 2.0 Flash Exp** (default) - 90% of tasks
   - CRM operations
   - LinkedIn messages
   - General queries
   - Tool execution

2. **Gemini 2.0 Flash Thinking Exp** - Complex reasoning
   - Multi-step workflows
   - Problem diagnosis
   - Strategic planning

3. **Gemini Exp 1206** - Critical tasks
   - Important decisions
   - Complex analysis
   - Long-form content

4. **Groq Llama 3.1 70B** - Speed critical
   - Quick lookups
   - Simple confirmations
   - High-volume operations

## How to Switch Models (Future)

Currently, Tim uses the default model configured in `/root/.nanobot/config.json`.

To enable dynamic model switching, Nanobot would need to support:
- Model selection per message
- Context-based routing
- User-specified model preference

## Performance Comparison

| Model | Speed | Cost | Quality | Best Use |
|-------|-------|------|---------|----------|
| Gemini 2.0 Flash Exp | ⚡⚡⚡ | 💰 | ⭐⭐⭐ | Default |
| Gemini 2.0 Flash Thinking | ⚡⚡ | 💰💰 | ⭐⭐⭐⭐ | Complex |
| Gemini Exp 1206 | ⚡ | 💰💰💰 | ⭐⭐⭐⭐⭐ | Critical |
| Groq Llama 3.1 70B | ⚡⚡⚡⚡ | 💰 | ⭐⭐⭐ | Speed |

## API Keys

All Gemini models use the same API key:
- **Gemini API Key**: Configured in `/root/.nanobot/config.json`
- **Groq API Key**: Separate key for Groq models

## Recommendations

1. **Keep Gemini 2.0 Flash Exp as default** - Best balance of speed, cost, and quality
2. **Use thinking model for debugging** - When troubleshooting complex issues
3. **Reserve Pro model for critical tasks** - Important decisions only
4. **Use Groq for speed bursts** - When you need ultra-fast responses

## Future Enhancements

Potential improvements:
- Automatic model selection based on task complexity
- User preference for model per conversation
- Cost tracking per model
- Performance metrics
