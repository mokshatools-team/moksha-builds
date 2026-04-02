"""Flask application factory for Video Post Studio."""

from flask import Flask

from app.routes.shell import shell_bp


def create_app() -> Flask:
    """Create and configure the Video Post Studio Flask app."""

    app = Flask(__name__, template_folder="templates")
    app.register_blueprint(shell_bp)
    return app
