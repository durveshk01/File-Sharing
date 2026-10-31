"""MIME type and file signature (magic byte) validator."""
import mimetypes

SIGNATURES = [
    (b"%PDF-", "application/pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"\x1f\x8b", "application/gzip"),
    (b"PK\x03\x04", "application/zip"),  # Also covers .docx, .xlsx, .pptx
]

DISALLOWED_EXECUTABLE_MAGIC = [
    (b"MZ", "Windows Executable (PE)"),
    (b"\x7fELF", "Linux ELF Executable"),
    (b"\xca\xfe\xba\xbe", "Java Class / Mach-O Fat Binary"),
    (b"\xfe\xed\xfa\xce", "Mach-O 32-bit"),
    (b"\xfe\xed\xfa\xcf", "Mach-O 64-bit"),
    (b"\xce\xfa\xed\xfe", "Mach-O Reverse 32-bit"),
    (b"\xcf\xfa\xed\xfe", "Mach-O Reverse 64-bit"),
    (b"\x00asm", "WebAssembly Binary"),
]

def detect_signature(content: bytes) -> str | None:
    """Detect known file signatures from magic bytes."""
    if not content:
        return None
    for magic, mime in SIGNATURES:
        if content.startswith(magic):
            return mime
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if len(content) >= 8 and content[4:8] == b"ftyp":
        return "video/mp4"
    if content.startswith(b"ID3") or (len(content) >= 2 and content[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")):
        return "audio/mpeg"
    return None

def is_text_content(content: bytes) -> bool:
    """Check if content is valid UTF-8 text without non-printable control chars."""
    sample = content[:4096]
    # Check for null bytes
    if b"\x00" in sample:
        return False
    try:
        sample.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False

def validate_file_content(content: bytes, declared_type: str, filename: str) -> tuple[bool, str, str]:
    """
    Validate that the file content does not spoof dangerous signatures and matches declared type.
    Returns: (is_valid, resolved_mime_type, error_message)
    """
    if not content:
        return False, "", "File content is empty"
    
    # Check against disallowed executable signatures if disguised as media or text
    for magic, name in DISALLOWED_EXECUTABLE_MAGIC:
        if content.startswith(magic):
            # If masquerading as image, text, or document, explicitly reject
            if any(declared_type.startswith(p) for p in ("image/", "text/", "audio/", "video/")) or declared_type in ("application/pdf", "application/json"):
                return False, "", f"Security violation: File header matches dangerous format ({name})"

    detected = detect_signature(content)
    
    # If a specific image/document signature is detected, ensure declared type is compatible
    if detected:
        if detected == "application/zip":
            # ZIP container could be .zip, .docx, .xlsx, .pptx, etc.
            if declared_type in (
                "application/zip",
                "application/x-zip-compressed",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ):
                return True, declared_type, ""
            return True, "application/zip", ""
        
        if declared_type.startswith("image/") and not detected.startswith("image/"):
            return False, "", f"File signature ({detected}) does not match declared image type ({declared_type})"
        if declared_type == "application/pdf" and detected != "application/pdf":
            return False, "", "File claims to be PDF but lacks PDF magic bytes"
            
        return True, detected, ""

    # Check text types (text/*, application/json, application/javascript, etc.)
    if declared_type.startswith("text/") or declared_type in ("application/json", "application/xml", "application/javascript"):
        if not is_text_content(content):
            return False, "", "File content contains invalid binary data for declared text format"
        return True, declared_type, ""

    # Check fallback by extension
    guessed_type, _ = mimetypes.guess_type(filename)
    resolved = declared_type or guessed_type or "application/octet-stream"
    return True, resolved, ""
