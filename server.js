require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store active threads
const activeThreads = new Map();

app.post('/api/query/stream', async (req, res) => {
  try {
    console.log('Received query:', req.body.query);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { query, threadId: existingThreadId } = req.body;
    const assistantId = process.env.ASSISTANT_ID;
    const vectorStoreId = process.env.VECTOR_STORE_ID;

    // Get or create thread
    let threadId;
    if (existingThreadId && activeThreads.has(existingThreadId)) {
      threadId = existingThreadId;
      console.log('Using existing thread:', threadId);
    } else {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      activeThreads.set(threadId, true);
      console.log('Created new thread:', threadId);
    }

    console.log('Adding message to thread...');
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: query
    });

    console.log('Starting run with vector store:', vectorStoreId);
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
      tools: [{ type: "file_search" }],
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStoreId]
        }
      }
    });

    // Send initial status with threadId
    res.write(`data: ${JSON.stringify({ 
      event: 'textCreated', 
      content: '', 
      status: 'started',
      threadId 
    })}\n\n`);

    // Poll for updates
    while (true) {
      const runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
      
      console.log('Current run status:', runStatus.status);
      if (runStatus.status === 'in_progress') {
        res.write(`data: ${JSON.stringify({ 
          event: 'inProgress', 
          content: '', 
          status: 'in_progress',
          threadId 
        })}\n\n`);
      }

      if (runStatus.status === 'completed') {
        // Get all messages in the thread
        const messages = await openai.beta.threads.messages.list(threadId);
        const conversationHistory = messages.data.map(msg => ({
          role: msg.role,
          content: msg.content[0]?.type === 'text' ? msg.content[0].text.value : '',
          citations: []
        })).reverse(); // Reverse to show oldest first

        // Process citations for the latest message
        const latestMessage = messages.data[0];
        if (latestMessage?.content?.[0]?.type === 'text') {
          const { text } = latestMessage.content[0];
          const { annotations = [] } = text;
          const citations = [];

          let processedText = text.value;

          // Process citations if any
          let index = 0;
          for (let annotation of annotations) {
            const { text: citationText, file_citation } = annotation;
            
            processedText = processedText.replace(citationText, `[${index}]`);
            
            if (file_citation) {
              try {
                const citedFile = await openai.files.retrieve(file_citation.file_id);
                citations.push({
                  text: citationText,
                  filename: citedFile.filename
                });
              } catch (error) {
                console.error('Error retrieving citation:', error);
              }
            }
            index++;
          }

          // Update the latest message with processed text and citations
          conversationHistory[conversationHistory.length - 1].content = processedText;
          conversationHistory[conversationHistory.length - 1].citations = citations;
        }

        res.write(`data: ${JSON.stringify({
          event: 'messageDone',
          messages: conversationHistory,
          status: 'completed',
          threadId,
          done: true
        })}\n\n`);
        break;
      } else if (runStatus.status === 'failed') {
        res.write(`data: ${JSON.stringify({ 
          event: 'error', 
          error: 'Assistant run failed', 
          done: true 
        })}\n\n`);
        break;
      } else if (runStatus.status === 'requires_action') {
        res.write(`data: ${JSON.stringify({ 
          event: 'toolCallCreated', 
          type: 'file_search' 
        })}\n\n`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    res.end();
  } catch (error) {
    console.error('Error:', error);
    res.write(`data: ${JSON.stringify({ 
      event: 'error', 
      error: 'An error occurred while processing your request', 
      done: true 
    })}\n\n`);
    res.end();
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
