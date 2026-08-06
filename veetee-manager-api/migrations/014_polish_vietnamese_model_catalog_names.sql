-- Làm rõ metadata catalog sau khi loại bỏ tên legacy khó đọc.

UPDATE veetee_manager.ai_model_provider
SET name = CASE id
  WHEN 'SYSTEM_ASR_AliyunASR' THEN 'Alibaba Cloud — nhận dạng giọng nói'
  WHEN 'SYSTEM_ASR_AliyunBLStream' THEN 'Alibaba Model Studio Paraformer — nhận dạng streaming'
  WHEN 'SYSTEM_ASR_AliyunStreamASR' THEN 'Alibaba Cloud — nhận dạng streaming'
  WHEN 'SYSTEM_ASR_BaiduASR' THEN 'Baidu — nhận dạng giọng nói'
  WHEN 'SYSTEM_ASR_DoubaoASR' THEN 'Volcengine — nhận dạng giọng nói'
  WHEN 'SYSTEM_ASR_DoubaoStreamASR' THEN 'Volcengine — nhận dạng streaming'
  WHEN 'SYSTEM_ASR_FunASR' THEN 'FunASR — nhận dạng giọng nói'
  WHEN 'SYSTEM_ASR_FunASRServer' THEN 'FunASR Server — nhận dạng giọng nói'
  WHEN 'SYSTEM_ASR_OpenaiASR' THEN 'OpenAI — nhận dạng giọng nói'
  WHEN 'SYSTEM_ASR_Qwen3Flash' THEN 'Qwen3 ASR Flash — nhận dạng giọng nói'
  WHEN 'SYSTEM_ASR_SherpaASR' THEN 'Sherpa ASR — nhận dạng giọng nói'
  WHEN 'SYSTEM_ASR_TencentASR' THEN 'Tencent — nhận dạng giọng nói'
  WHEN 'SYSTEM_ASR_VoskASR' THEN 'Vosk — nhận dạng offline'
  WHEN 'SYSTEM_ASR_XunfeiStream' THEN 'iFlytek — nhận dạng streaming'
  WHEN 'SYSTEM_LLM_AliBL' THEN 'Alibaba Model Studio API'
  WHEN 'SYSTEM_LLM_coze' THEN 'Coze API'
  WHEN 'SYSTEM_LLM_dify' THEN 'Dify API'
  WHEN 'SYSTEM_LLM_fastgpt' THEN 'FastGPT API'
  WHEN 'SYSTEM_LLM_gemini' THEN 'Gemini API'
  WHEN 'SYSTEM_LLM_ollama' THEN 'Ollama API'
  WHEN 'SYSTEM_LLM_openai' THEN 'OpenAI API'
  WHEN 'SYSTEM_LLM_xinference' THEN 'Xinference API'
  WHEN 'SYSTEM_Memory_mem0ai' THEN 'Mem0AI — ghi nhớ'
  WHEN 'SYSTEM_PLUGIN_CALL_DEVICE' THEN 'Thiết bị gọi thiết bị'
  WHEN 'SYSTEM_PLUGIN_HA_GET_STATE' THEN 'Home Assistant — tra cứu thiết bị'
  WHEN 'SYSTEM_PLUGIN_HA_PLAY_MUSIC' THEN 'Home Assistant — phát nhạc'
  WHEN 'SYSTEM_PLUGIN_HA_SET_STATE' THEN 'Home Assistant — điều khiển thiết bị'
  WHEN 'SYSTEM_PLUGIN_MUSIC' THEN 'Phát nhạc trên máy chủ'
  WHEN 'SYSTEM_PLUGIN_NEWS_NEWSNOW' THEN 'NewsNow — tổng hợp tin tức'
  WHEN 'SYSTEM_TTS_AliBLStreamTTS' THEN 'Alibaba Model Studio — streaming TTS'
  WHEN 'SYSTEM_TTS_AliyunStreamTTS' THEN 'Alibaba Cloud — streaming TTS'
  WHEN 'SYSTEM_TTS_HSDSTTS' THEN 'Volcengine — streaming TTS'
  WHEN 'SYSTEM_TTS_IndexStreamTTS' THEN 'Index-TTS-vLLM — streaming'
  WHEN 'SYSTEM_TTS_MinimaxStreamTTS' THEN 'Minimax — streaming TTS'
  WHEN 'SYSTEM_TTS_TencentTTS' THEN 'Tencent — TTS'
  WHEN 'SYSTEM_TTS_XunFeiStreamTTS' THEN 'iFlytek — streaming TTS'
  WHEN 'SYSTEM_TTS_aliyun' THEN 'Alibaba Cloud — TTS'
  WHEN 'SYSTEM_TTS_custom' THEN 'TTS tùy chỉnh'
  WHEN 'SYSTEM_TTS_doubao' THEN 'Doubao — TTS'
  WHEN 'SYSTEM_TTS_siliconflow' THEN 'SiliconFlow — TTS'
  WHEN 'SYSTEM_VAD_SileroVAD' THEN 'Silero VAD — phát hiện hoạt động giọng nói'
  ELSE name
END,
update_date = now()
WHERE id IN (
  'SYSTEM_ASR_AliyunASR','SYSTEM_ASR_AliyunBLStream','SYSTEM_ASR_AliyunStreamASR','SYSTEM_ASR_BaiduASR',
  'SYSTEM_ASR_DoubaoASR','SYSTEM_ASR_DoubaoStreamASR','SYSTEM_ASR_FunASR','SYSTEM_ASR_FunASRServer',
  'SYSTEM_ASR_OpenaiASR','SYSTEM_ASR_Qwen3Flash','SYSTEM_ASR_SherpaASR','SYSTEM_ASR_TencentASR',
  'SYSTEM_ASR_VoskASR','SYSTEM_ASR_XunfeiStream','SYSTEM_LLM_AliBL','SYSTEM_LLM_coze','SYSTEM_LLM_dify',
  'SYSTEM_LLM_fastgpt','SYSTEM_LLM_gemini','SYSTEM_LLM_ollama','SYSTEM_LLM_openai','SYSTEM_LLM_xinference',
  'SYSTEM_Memory_mem0ai','SYSTEM_PLUGIN_CALL_DEVICE','SYSTEM_PLUGIN_HA_GET_STATE','SYSTEM_PLUGIN_HA_PLAY_MUSIC',
  'SYSTEM_PLUGIN_HA_SET_STATE','SYSTEM_PLUGIN_MUSIC','SYSTEM_PLUGIN_NEWS_NEWSNOW','SYSTEM_TTS_AliBLStreamTTS',
  'SYSTEM_TTS_AliyunStreamTTS','SYSTEM_TTS_HSDSTTS','SYSTEM_TTS_IndexStreamTTS','SYSTEM_TTS_MinimaxStreamTTS',
  'SYSTEM_TTS_TencentTTS','SYSTEM_TTS_XunFeiStreamTTS','SYSTEM_TTS_aliyun','SYSTEM_TTS_custom','SYSTEM_TTS_doubao',
  'SYSTEM_TTS_siliconflow','SYSTEM_VAD_SileroVAD'
);

UPDATE veetee_manager.ai_model_config
SET model_name = CASE id
  WHEN 'ASR_AliyunASR' THEN 'Alibaba Cloud — nhận dạng giọng nói'
  WHEN 'ASR_AliyunBLStream' THEN 'Alibaba Model Studio Paraformer — nhận dạng streaming'
  WHEN 'ASR_AliyunStreamASR' THEN 'Alibaba Cloud — nhận dạng streaming'
  WHEN 'ASR_BaiduASR' THEN 'Baidu — nhận dạng giọng nói'
  WHEN 'ASR_DoubaoASR' THEN 'Doubao — nhận dạng giọng nói'
  WHEN 'ASR_DoubaoStreamASR' THEN 'Doubao — nhận dạng streaming'
  WHEN 'ASR_DoubaoStreamASRV2' THEN 'Doubao — nhận dạng streaming 2.0'
  WHEN 'ASR_FunASR' THEN 'FunASR — nhận dạng giọng nói'
  WHEN 'ASR_FunASRServer' THEN 'FunASR Server — nhận dạng giọng nói'
  WHEN 'ASR_GroqASR' THEN 'Groq — nhận dạng giọng nói'
  WHEN 'ASR_OpenaiASR' THEN 'OpenAI — nhận dạng giọng nói'
  WHEN 'ASR_Qwen3Flash' THEN 'Qwen3 ASR Flash — nhận dạng giọng nói'
  WHEN 'ASR_SherpaASR' THEN 'Sherpa ASR — nhận dạng giọng nói'
  WHEN 'ASR_TencentASR' THEN 'Tencent — nhận dạng giọng nói'
  WHEN 'ASR_VoskASR' THEN 'Vosk — nhận dạng offline'
  WHEN 'ASR_XunfeiStream' THEN 'iFlytek — nhận dạng streaming'
  WHEN 'LLM_AliAppLLM' THEN 'Alibaba Model Studio'
  WHEN 'LLM_AliLLM' THEN 'Qwen'
  WHEN 'LLM_ChatGLMLLM' THEN 'Zhipu AI'
  WHEN 'LLM_DoubaoLLM' THEN 'Doubao — mô hình ngôn ngữ'
  WHEN 'LLM_GeminiLLM' THEN 'Google Gemini'
  WHEN 'LLM_OllamaLLM' THEN 'Ollama — model local'
  WHEN 'LLM_VolcesAiGatewayLLM' THEN 'Volcengine — gateway mô hình'
  WHEN 'LLM_XinferenceLLM' THEN 'Xinference — model lớn'
  WHEN 'LLM_XinferenceSmallLLM' THEN 'Xinference — model nhỏ'
  WHEN 'LLM_XunfeiSparkLLM' THEN 'iFlytek — mô hình ngôn ngữ'
  WHEN 'TTS_AliBLStreamTTS' THEN 'Alibaba Model Studio — streaming TTS'
  WHEN 'TTS_AliyunStreamTTS' THEN 'Alibaba Cloud — streaming TTS'
  WHEN 'TTS_AliyunTTS' THEN 'Alibaba Cloud — TTS'
  WHEN 'TTS_CosyVoiceSiliconflow' THEN 'SiliconFlow — TTS'
  WHEN 'TTS_CozeCnTTS' THEN 'Coze — TTS tiếng Trung'
  WHEN 'TTS_CustomTTS' THEN 'TTS tùy chỉnh'
  WHEN 'TTS_DoubaoTTS' THEN 'Doubao — TTS'
  WHEN 'TTS_EdgeTTS' THEN 'Edge TTS'
  WHEN 'TTS_FishSpeech' THEN 'FishSpeech — TTS'
  WHEN 'TTS_HSDSTTS_V2' THEN 'Doubao — TTS 2.0'
  WHEN 'TTS_HuoshanDoubleStreamTTS' THEN 'Volcengine — TTS streaming hai chiều'
  WHEN 'TTS_IndexStreamTTS' THEN 'Index-TTS-vLLM — streaming'
  WHEN 'TTS_MinimaxStreamTTS' THEN 'Minimax — streaming TTS'
  WHEN 'TTS_OpenAITTS' THEN 'OpenAI — TTS'
  WHEN 'TTS_TTS302AI' THEN '302AI — TTS'
  WHEN 'TTS_TencentTTS' THEN 'Tencent — TTS'
  WHEN 'TTS_VolcesAiGatewayTTS' THEN 'Volcengine — gateway TTS'
  WHEN 'TTS_XunFeiStreamTTS' THEN 'iFlytek — streaming TTS'
  WHEN 'VAD_SileroVAD' THEN 'Silero VAD — phát hiện hoạt động giọng nói'
  WHEN 'VLLM_ChatGLMVLLM' THEN 'Zhipu AI — thị giác'
  WHEN 'VLLM_QwenVLVLLM' THEN 'Qwen — model thị giác'
  ELSE model_name
END,
update_date = now()
WHERE id IN (
  'ASR_AliyunASR','ASR_AliyunBLStream','ASR_AliyunStreamASR','ASR_BaiduASR','ASR_DoubaoASR','ASR_DoubaoStreamASR',
  'ASR_DoubaoStreamASRV2','ASR_FunASR','ASR_FunASRServer','ASR_GroqASR','ASR_OpenaiASR','ASR_Qwen3Flash',
  'ASR_SherpaASR','ASR_TencentASR','ASR_VoskASR','ASR_XunfeiStream','LLM_AliAppLLM','LLM_AliLLM','LLM_ChatGLMLLM',
  'LLM_DoubaoLLM','LLM_GeminiLLM','LLM_OllamaLLM','LLM_VolcesAiGatewayLLM','LLM_XinferenceLLM','LLM_XinferenceSmallLLM',
  'LLM_XunfeiSparkLLM','TTS_AliBLStreamTTS','TTS_AliyunStreamTTS','TTS_AliyunTTS','TTS_CosyVoiceSiliconflow',
  'TTS_CozeCnTTS','TTS_CustomTTS','TTS_DoubaoTTS','TTS_EdgeTTS','TTS_FishSpeech','TTS_HSDSTTS_V2',
  'TTS_HuoshanDoubleStreamTTS','TTS_IndexStreamTTS','TTS_MinimaxStreamTTS','TTS_OpenAITTS','TTS_TTS302AI',
  'TTS_TencentTTS','TTS_VolcesAiGatewayTTS','TTS_XunFeiStreamTTS','VAD_SileroVAD','VLLM_ChatGLMVLLM','VLLM_QwenVLVLLM'
);

UPDATE veetee_manager.ai_model_config
SET remark = 'Tích hợp kho kiến thức RAGFlow tùy chọn. Hãy cung cấp Base URL và API key của dịch vụ trước khi bật.',
    update_date = now()
WHERE id = 'RAG_RAGFlow';
