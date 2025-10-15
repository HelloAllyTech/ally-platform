"""
Email template utilities.
"""

import os
from pathlib import Path
from typing import Dict, Any

# Get the templates directory path
TEMPLATES_DIR = Path(__file__).parent


def load_email_template(template_name: str, **kwargs: Any) -> Dict[str, str]:
    """
    Load email template (both HTML and text versions) and format with provided variables.
    
    Args:
        template_name: Name of the template (without extension)
        **kwargs: Variables to format the template with
        
    Returns:
        Dict with 'html' and 'text' keys containing formatted templates
        
    Raises:
        FileNotFoundError: If template files don't exist
    """
    emails_dir = TEMPLATES_DIR / "emails"
    
    # Load HTML template
    html_path = emails_dir / f"{template_name}.html"
    if not html_path.exists():
        raise FileNotFoundError(f"HTML template not found: {html_path}")
    
    with open(html_path, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    # Load text template
    txt_path = emails_dir / f"{template_name}.txt"
    if not txt_path.exists():
        raise FileNotFoundError(f"Text template not found: {txt_path}")
    
    with open(txt_path, 'r', encoding='utf-8') as f:
        text_content = f.read()
    
    # Format templates with provided variables
    formatted_html = html_content.format(**kwargs)
    formatted_text = text_content.format(**kwargs)
    
    return {
        'html': formatted_html,
        'text': formatted_text
    }
