-- Allow WhatsApp Business attachments in the existing private social-media bucket.
-- Keep the bucket private; files are exposed only through short-lived signed URLs.
-- Preserve the existing 512 MB bucket ceiling; the WhatsApp endpoint separately
-- enforces its 25 MB per-attachment preview limit.
begin;

update storage.buckets
set
  public = false,
  file_size_limit = 524288000,
  allowed_mime_types = array[
    'image/jpeg','image/png','image/webp','image/gif','image/avif',
    'video/mp4','video/quicktime','video/webm','video/3gpp',
    'audio/ogg','audio/mpeg','audio/mp4','audio/aac','audio/amr','audio/webm',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]::text[]
where id = 'aam-social-media';

commit;
