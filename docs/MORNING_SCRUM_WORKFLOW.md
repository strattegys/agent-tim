# Morning Scrum Article Workflow

## Automated Workflow for Tim

When Tim receives a transcript with "morning scrum" in the title, follow this workflow:

### Step 1: Save Transcript

**Location**: `/mnt/gdrive/business-content-artist/morning-scrum-MMDDYYYY.txt`

**Naming Convention**: `morning-scrum-03-13-2026.txt` (use date from transcript or current date)

**Command**:
```bash
# Save transcript to file
cat > /mnt/gdrive/business-content-artist/morning-scrum-$(date +%m-%d-%Y).txt << 'EOF'
[transcript content here]
EOF
```

### Step 2: Ask for Confirmation

Tim should respond:
```
GMoney, I've saved the morning scrum transcript to:
/mnt/gdrive/business-content-artist/morning-scrum-MM-DD-YYYY.txt

Would you like me to write an article based on this transcript? If yes, please let me know how many words you'd like the article to be. 🚀🎧✨
```

### Step 3: Switch to Gemini Pro (if user says yes)

**Note**: Currently requires manual config change. GMoney will need to run:
```bash
ssh root@137.184.187.233 "sed -i 's/gemini-3.1-flash-lite-preview/gemini-3.1-pro-preview/' /root/.nanobot/config.json && systemctl restart nanobot"
```

**Future**: Nanobot should support per-task model switching

### Step 4: Generate Article with Gemini Pro

Use this prompt structure:

```
Write a [WORD_COUNT] word article based on this morning scrum conversation.

REQUIREMENTS:
1. Follow the theories, ideas, and insights from the conversation
2. Get technical where appropriate
3. Bring out each speaker's perspective
4. Research and support each key topic or idea with credible sources
5. Make the writing fun, intelligent, accessible, and flow naturally
6. Start with a great hook that draws readers in

STRUCTURE:
- Engaging hook/opening
- Main content with speaker perspectives
- Technical depth where relevant
- Research-backed insights
- Natural flow and transitions

ABOUT GOVIND DAVIS (GMoney):
Govind Davis is a strategic technology leader and founder focused on AI-driven business transformation. With expertise in go-to-market strategy, AI agent development, and enterprise systems, Govind helps organizations leverage cutting-edge technology to solve complex business challenges. He is the creator of TimBot, an AI assistant built on the Nanobot framework, and actively explores the intersection of AI, automation, and human collaboration.

DELIVERABLES:
1. Full article ([WORD_COUNT] words)
2. Include the diagram from the conversation (indicate placement)
3. Less than 300 character excerpt for social media
4. Engaging LinkedIn post example (with relevant hashtags)
5. Featured image specifications:
   - Dimensions: 1200x630px
   - Style: Professional, modern, tech-forward
   - Elements: [describe key visual elements from conversation]
   - Color palette: [suggest based on topic]
6. Three supporting images with specifications:
   - Image 1: [purpose and placement]
   - Image 2: [purpose and placement]
   - Image 3: [purpose and placement]
7. Image placement indicators throughout article

FORMAT:
- Use markdown formatting
- Indicate image placements with: [IMAGE: description]
- Indicate diagram placement with: [DIAGRAM: title]
- Include section headers
- Add pull quotes from speakers where impactful

TRANSCRIPT:
[Insert transcript content here]
```

### Step 5: Save Generated Article

**Location**: `/mnt/gdrive/business-content-artist/articles/morning-scrum-MMDDYYYY-article.md`

**Command**:
```bash
cat > /mnt/gdrive/business-content-artist/articles/morning-scrum-$(date +%m-%d-%Y)-article.md << 'EOF'
[generated article content]
EOF
```

### Step 6: Deliver to GMoney

Provide:
1. Link to saved article file
2. Excerpt (under 300 chars)
3. LinkedIn post example
4. Image specifications summary

## Example Response Flow

**User sends**: "Here's the morning scrum transcript from today..."

**Tim responds**: 
```
GMoney, I've saved the morning scrum transcript to:
/mnt/gdrive/business-content-artist/morning-scrum-03-13-2026.txt

Would you like me to write an article based on this transcript? If yes, please let me know how many words you'd like the article to be. 🚀🎧✨
```

**User responds**: "Yes, write a 2000 word article"

**Tim (after switching to Gemini Pro)**: 
```
Switching to Gemini Pro for high-quality article generation...

[Generates article with all requirements]

Article complete! I've saved it to:
/mnt/gdrive/business-content-artist/articles/morning-scrum-03-13-2026-article.md

EXCERPT (298 chars):
[excerpt here]

LINKEDIN POST:
[engaging post with hashtags]

IMAGE SPECIFICATIONS:
- Featured Image: [specs]
- Supporting Images: [3 image specs with placements]

Ready for your review! 🚀🎧✨
```

## Govind Davis Bio (for articles)

**Short Version** (for bylines):
Govind Davis is a strategic technology leader focused on AI-driven business transformation and the creator of TimBot, an AI assistant built on the Nanobot framework.

**Medium Version** (for author sections):
Govind Davis is a strategic technology leader and founder specializing in AI-driven business transformation. With deep expertise in go-to-market strategy, AI agent development, and enterprise systems, Govind helps organizations leverage cutting-edge technology to solve complex business challenges. He is the creator of TimBot, an AI assistant built on the Nanobot framework, and actively explores the intersection of AI, automation, and human collaboration through his work at Strattegys.

**Long Version** (for feature articles):
Govind Davis (GMoney) is a visionary technology leader and entrepreneur at the forefront of AI-driven business transformation. As the founder and strategic architect behind innovative AI solutions, Govind combines deep technical expertise with strategic business acumen to help organizations navigate the rapidly evolving landscape of artificial intelligence and automation.

With a background spanning go-to-market strategy, enterprise systems architecture, and AI agent development, Govind has pioneered practical applications of AI that bridge the gap between cutting-edge technology and real-world business needs. He is the creator of TimBot, a sophisticated AI assistant built on the Nanobot framework, which demonstrates his commitment to building intelligent systems that enhance rather than replace human capability.

Govind's work focuses on the intersection of AI, automation, and human collaboration, exploring how organizations can leverage advanced technologies like large language models, CRM integration, and workflow automation to achieve breakthrough results. Through his company Strattegys and his daily "morning scrum" sessions, he shares insights on AI strategy, technical implementation, and the future of work in an AI-augmented world.

## Technical Notes

**Current Limitation**: Nanobot doesn't support dynamic model switching per message. GMoney must manually switch the config to use Gemini Pro.

**Workaround**: 
1. Tim detects morning scrum transcript
2. Tim asks for confirmation and word count
3. GMoney manually switches to Gemini Pro
4. Tim generates article with Pro model
5. GMoney switches back to Flash Lite for normal operations

**Future Enhancement**: Add model selection parameter to Nanobot to enable per-task model switching without config changes.
