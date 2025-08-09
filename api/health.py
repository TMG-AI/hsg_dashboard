# api/health.py
def handler(request):
    # Return a plain string + 200 to avoid any JSON/encoding edge cases
    return ("OK", 200)
