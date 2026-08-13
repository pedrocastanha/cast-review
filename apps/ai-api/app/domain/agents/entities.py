from dataclasses import dataclass
from typing import Literal

Severity = Literal["fail", "warning", "pass"]


@dataclass(frozen=True)
class Finding:
    status: Severity
    title: str
    detail: str
    business_rule: str | None = None
    convention_ref: str | None = None
    path: str | None = None
    line: int | None = None
    end_line: int | None = None

    def to_payload(self) -> dict:
        payload: dict = {
            "status": self.status,
            "title": self.title,
            "detail": self.detail,
        }
        if self.business_rule:
            payload["businessRule"] = self.business_rule
        if self.convention_ref:
            payload["conventionRef"] = self.convention_ref
        if self.path:
            payload["path"] = self.path
        if self.line is not None:
            payload["line"] = self.line
        if self.end_line is not None:
            payload["endLine"] = self.end_line
        return payload
