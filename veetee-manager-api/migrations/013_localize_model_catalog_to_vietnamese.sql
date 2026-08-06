-- Chuẩn hóa dữ liệu catalog cũ sang tiếng Việt.
-- Không đổi ID, provider code, model code hoặc JSON key; chỉ đổi metadata hiển
-- thị và chuỗi mặc định. Catalog nguồn hiện tại đã là tiếng Việt; phần làm
-- sạch bên dưới bảo vệ database khi gặp bản ghi legacy chưa được chuyển đổi.

ALTER TABLE veetee_manager.ai_model_provider
  ALTER COLUMN name TYPE varchar(120);
ALTER TABLE veetee_manager.ai_model_config
  ALTER COLUMN model_name TYPE varchar(120),
  ALTER COLUMN model_code TYPE varchar(160);

CREATE OR REPLACE FUNCTION veetee_manager.localize_catalog_text(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  value text := input;
  cjk_pattern text := format('[%s-%s]', chr(13312), chr(40959));
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  -- Hướng dẫn legacy có thể chứa cả lệnh triển khai không còn phù hợp với
  -- môi trường host-native; thay bằng hướng dẫn ngắn, an toàn.
  IF value LIKE 'RAGFlow%' AND value ~ cjk_pattern THEN
    RETURN 'Tích hợp kho kiến thức RAGFlow tùy chọn. Hãy cung cấp Base URL và API key của dịch vụ trước khi bật.';
  END IF;
  -- Catalog mới không chứa văn bản CJK. Nếu một bản ghi cũ lọt vào, loại bỏ
  -- glyph chưa dịch thay vì để chúng xuất hiện trên Manager Web.
  value := regexp_replace(value, cjk_pattern, '', 'g');
  RETURN trim(regexp_replace(value, '[[:space:]]{2,}', ' ', 'g'));
END;
$$;

CREATE OR REPLACE FUNCTION veetee_manager.localize_catalog_json(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  CASE jsonb_typeof(input)
    WHEN 'object' THEN
      SELECT COALESCE(jsonb_object_agg(key, veetee_manager.localize_catalog_json(value)), '{}'::jsonb)
        INTO result FROM jsonb_each(input);
      RETURN result;
    WHEN 'array' THEN
      SELECT COALESCE(jsonb_agg(veetee_manager.localize_catalog_json(value)), '[]'::jsonb)
        INTO result FROM jsonb_array_elements(input);
      RETURN result;
    WHEN 'string' THEN
      RETURN to_jsonb(veetee_manager.localize_catalog_text(input #>> '{}'));
    ELSE
      RETURN input;
  END CASE;
END;
$$;

UPDATE veetee_manager.ai_model_provider
SET name = veetee_manager.localize_catalog_text(name),
    fields = veetee_manager.localize_catalog_json(fields),
    update_date = now()
WHERE name ~ format('[%s-%s]', chr(13312), chr(40959))
   OR fields::text ~ format('[%s-%s]', chr(13312), chr(40959));

UPDATE veetee_manager.ai_model_config
SET model_name = veetee_manager.localize_catalog_text(model_name),
    remark = CASE WHEN id = 'RAG_RAGFlow' THEN 'Tích hợp kho kiến thức RAGFlow tùy chọn. Hãy cung cấp Base URL và API key của dịch vụ trước khi bật.' ELSE veetee_manager.localize_catalog_text(remark) END,
    config_json = veetee_manager.localize_catalog_json(config_json),
    update_date = now()
WHERE model_name ~ format('[%s-%s]', chr(13312), chr(40959))
   OR coalesce(remark, '') ~ format('[%s-%s]', chr(13312), chr(40959))
   OR config_json::text ~ format('[%s-%s]', chr(13312), chr(40959));

UPDATE veetee_manager.ai_tts_voice
SET name = veetee_manager.localize_catalog_text(name),
    remark = veetee_manager.localize_catalog_text(remark),
    reference_text = veetee_manager.localize_catalog_text(reference_text),
    update_date = now()
WHERE name ~ format('[%s-%s]', chr(13312), chr(40959))
   OR coalesce(remark, '') ~ format('[%s-%s]', chr(13312), chr(40959))
   OR coalesce(reference_text, '') ~ format('[%s-%s]', chr(13312), chr(40959));

DROP FUNCTION veetee_manager.localize_catalog_json(jsonb);
DROP FUNCTION veetee_manager.localize_catalog_text(text);
