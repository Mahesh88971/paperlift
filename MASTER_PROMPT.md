# Paperlift master prompt

Build **Paperlift**, a responsive website that turns the words on a printed page into editable digital text. Let the user hold up a page to a webcam or rear phone camera, upload a photo, drag in an image, or paste an image from the clipboard. Capture one still image per scan and automatically recognize the text using browser-side OCR.

## Transcription

- Keep the source image visible so the user can check the result against it. Provide a full-size preview for checking small print.
- Insert the OCR transcript directly into an editable text area. Preserve the recognized wording, capitalization, numbers, punctuation, and line breaks. Avoid rewriting, translating, correcting, or completing the source automatically.
- Let users copy the edited transcript and download it as a UTF-8 text file.
- Open directly on the production scanner. Keep demonstration pages, fixtures, and sample transcripts out of the published site.
- Show progress during recognition. Give specific recovery instructions for camera errors, unsupported images, blurry pages, and empty results. Keep the camera closed outside capture.

## Visual direction

Use a rich navy base with moving violet, rose, and teal light. Place the scanner and editor in translucent glass panels with crisp borders and readable text. Use two columns on desktop and a stacked flow on phones. Frame the page preview with scanner corners on a subtle dot grid. Use a clean, spacious text editor with word and character counts.

Animate the workspace entrance, camera dialog, state changes, and button feedback. Move a scanning line over the page while OCR is running, driven by actual progress. Keep transitions quick and honor reduced-motion preferences. Support keyboard navigation, accessible labels, and status announcements.

## Acceptance checks

Confirm that independent test images produce their own transcripts. Check camera capture and camera-denied behavior, text editing, clipboard copy, text download, and mobile layout. Process the image on the user's device and avoid uploading or saving their documents. Serve the scanner and its bundled assets over HTTPS.
