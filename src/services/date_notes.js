"use strict";

const noteService = require('./notes');
const becca = require('../becca/becca');
const attributeService = require('./attributes');
const dateUtils = require('./date_utils');
const sql = require('./sql');
const protectedSessionService = require('./protected_session');
const cls = require("./cls");
const searchService = require('../services/search/services/search');
const SearchContext = require('../services/search/search_context');
const hoistedNoteService = require("./hoisted_note");

const CALENDAR_ROOT_LABEL = 'calendarRoot';
const YEAR_LABEL = 'yearNote';
const MONTH_LABEL = 'monthNote';
const WEEK_LABEL = 'weekNote';
const DATE_LABEL = 'dateNote';

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function createNote(parentNote, noteTitle) {
    return noteService.createNewNote({
        parentNoteId: parentNote.noteId,
        title: noteTitle,
        content: '',
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable(),
        type: 'text'
    }).note;
}

/** @returns {BNote} */
function getRootCalendarNote() {
    let rootNote;

    const workspaceNote = hoistedNoteService.getWorkspaceNote();

    if (!workspaceNote.isRoot()) {
        rootNote = searchService.findFirstNoteWithQuery('#workspaceCalendarRoot', new SearchContext({ignoreHoistedNote: false}));
    }

    if (!rootNote) {
        rootNote = attributeService.getNoteWithLabel(CALENDAR_ROOT_LABEL);
    }

    if (!rootNote) {
        sql.transactional(() => {
            rootNote = noteService.createNewNote({
                parentNoteId: 'root',
                title: 'Calendar',
                target: 'into',
                isProtected: false,
                type: 'text',
                content: ''
            }).note;

            attributeService.createLabel(rootNote.noteId, CALENDAR_ROOT_LABEL);
            attributeService.createLabel(rootNote.noteId, 'sorted');
        });
    }

    return rootNote;
}

function getParentNote(label, dateStr, rootNote) {
    console.log('getParentNote', label, dateStr);
    const type = rootNote.getOwnedLabelValue("calendarType") || "monthly";
    if (type != "monthly" && type != "weekly") {
        throw new Error('#calendarType should be "monthly" or "weekly"');
    }
    const pattern = type == "monthly" ? "year/month/day" : "year/week/day";

    let parentLabel = "root";
    for (const currLabel of pattern.split("/")) {
        if (currLabel === label) {
            break;
        }
        parentLabel = currLabel;
    }
    switch (parentLabel) {
        case "root":
            return rootNote;
        case "year":
            return getYearNote(dateStr, rootNote);
        case "month":
            return getMonthNote(dateStr, rootNote);
        case "week":
            return getWeekNote(dateStr, rootNote);
        case "day":
            return getDayNote(dateStr, rootNote);
    }
    return null;
}

function getNoteTitle(pattern, dateStr, options = {}) {
    const dateObj = dateUtils.parseLocalDate(dateStr);
    const weekDay = DAYS[dateObj.getDay()];
    const startOfTheWeek = options.startOfTheWeek || "monday";
    return pattern.replace(/{(\w+)}/g, function(_, match) {
        switch(match) {
            case 'year':
                return dateStr.substr(0, 4);
            case 'month':
                return MONTHS[dateObj.getMonth()];
            case "monthNumberPadded":
                return dateStr.substr(5, 2);
            case "weekNumber":
                return dateUtils.getWeek(dateObj, startOfTheWeek);
            case "weekNumberPadded":
            {
                let weekNum = dateUtils.getWeek(dateObj, startOfTheWeek);
                if (weekNum <= 9)
                    return "0" + weekNum;
                return weekNum;
            }
            case "weekDay":
                return weekDay;
            case "weekDay3":
                return weekDay.substr(0, 3);
            case "weekDay2":
                return weekDay.substr(0, 2);
            case "dayInMonthPadded":
                return dateStr.substr(8, 2);
            case "isoDate":
                return dateUtils.utcDateStr(dateObj);
            default:
                throw new Error(`unknown pattern {${match}}`);
        }
    });
}

/** @returns {BNote} */
function getYearNote(dateStr, rootNote = null) {
    if (!rootNote) {
        rootNote = getRootCalendarNote();
    }

    const yearStr = dateStr.trim().substr(0, 4);

    let yearNote = searchService.findFirstNoteWithQuery(`#${YEAR_LABEL}="${yearStr}"`,
            new SearchContext({ancestorNoteId: rootNote.noteId}));

    if (yearNote) {
        return yearNote;
    }

    const pattern = rootNote.getOwnedLabelValue("yearPattern") || "{year}";
    const parentNote = getParentNote("year", dateStr, rootNote);

    if (!parentNote) {
        let dateObj = dateUtils.parseLocalDate(dateStr);
        return getDayNote(dateUtils.utcDateTimeStr(dateObj.setMonth(0).setDate(1)), rootNote);
    }

    const noteTitle = getNoteTitle(pattern, dateStr);

    sql.transactional(() => {
        yearNote = createNote(parentNote, noteTitle);

        attributeService.createLabel(yearNote.noteId, YEAR_LABEL, yearStr);
        attributeService.createLabel(yearNote.noteId, 'sorted');

        const yearTemplateAttr = rootNote.getOwnedAttribute('relation', 'yearTemplate');

        if (yearTemplateAttr) {
            attributeService.createRelation(yearNote.noteId, 'template', yearTemplateAttr.value);
        }
    });

    return yearNote;
}

/** @returns {BNote} */
function getMonthNote(dateStr, rootNote = null) {
    if (!rootNote) {
        rootNote = getRootCalendarNote();
    }

    const monthStr = dateStr.substr(0, 7);
    const monthNumber = dateStr.substr(5, 2);

    let monthNote = searchService.findFirstNoteWithQuery(`#${MONTH_LABEL}="${monthStr}"`,
        new SearchContext({ancestorNoteId: rootNote.noteId}));

    if (monthNote) {
        return monthNote;
    }

    const pattern = rootNote.getOwnedLabelValue("monthPattern") || "{monthNumberPadded} - {month}";
    const parentNote = getParentNote("month", dateStr, rootNote);
    if (!parentNote) {
        let dateObj = dateUtils.parseLocalDate(dateStr);
        return getDayNote(dateUtils.utcDateTimeStr(dateObj.setDate(1)), rootNote);
    }

    const noteTitle = getNoteTitle(pattern, dateStr);

    sql.transactional(() => {
        monthNote = createNote(parentNote, noteTitle);

        attributeService.createLabel(monthNote.noteId, MONTH_LABEL, monthStr);
        attributeService.createLabel(monthNote.noteId, 'sorted');

        const monthTemplateAttr = rootNote.getOwnedAttribute('relation', 'monthTemplate');

        if (monthTemplateAttr) {
            attributeService.createRelation(monthNote.noteId, 'template', monthTemplateAttr.value);
        }
    });

    return monthNote;
}

/** @returns {BNote} */
function getDayNote(dateStr, rootNote = null) {
    if (!rootNote) {
        rootNote = getRootCalendarNote();
    }

    dateStr = dateStr.trim().substr(0, 10);

    let dateNote = searchService.findFirstNoteWithQuery(`#${DATE_LABEL}="${dateStr}"`,
        new SearchContext({ancestorNoteId: rootNote.noteId}));

    if (dateNote) {
        return dateNote;
    }

    const pattern = rootNote.getOwnedLabelValue("datePattern") || "{dayInMonthPadded} - {weekDay}";
    const noteTitle = getNoteTitle(pattern, dateStr);
    const parentNote = getParentNote("day", dateStr, rootNote);

    sql.transactional(() => {
        dateNote = createNote(parentNote, noteTitle);

        attributeService.createLabel(dateNote.noteId, DATE_LABEL, dateStr.substr(0, 10));

        const dateTemplateAttr = rootNote.getOwnedAttribute('relation', 'dateTemplate');

        if (dateTemplateAttr) {
            attributeService.createRelation(dateNote.noteId, 'template', dateTemplateAttr.value);
        }
    });

    return dateNote;
}

function getTodayNote(rootNote = null) {
    return getDayNote(dateUtils.localNowDate(), rootNote);
}

function getStartOfTheWeek(date, startOfTheWeek) {
    const day = date.getDay();
    let diff;

    if (startOfTheWeek === 'monday') {
        diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    }
    else if (startOfTheWeek === 'sunday') {
        diff = date.getDate() - day;
    }
    else {
        throw new Error(`Unrecognized start of the week ${startOfTheWeek}`);
    }

    return new Date(date.setDate(diff));
}

/** @returns {BNote} */
function getWeekNote(dateStr, options = {}, rootNote = null) {
    if (!rootNote) {
        rootNote = getRootCalendarNote();
    }

    const dateObj = dateUtils.parseLocalDate(dateStr);
    const startOfTheWeek = options.startOfTheWeek || "monday";
    const weekNumber = dateUtils.getWeek(dateObj, startOfTheWeek);
    const yearStr = dateStr.trim().substr(0, 4);
    let weekStr;
    if (weekNumber != 0) {
        weekStr = `${yearStr}WW${weekNumber}`;
    } else {
        let lastDayOfYear = new Date(dateObj.getFullYear() - 1, 11, 31);
        console.log(lastDayOfYear);
        let lastWeekNumber = dateUtils.getWeek(lastDayOfYear, startOfTheWeek);
        let yearStr = (dateObj.getFullYear() - 1).toString().padStart(4, '0');
        weekStr = `${yearStr}WW${lastWeekNumber}`;
    }

    let weekNote = searchService.findFirstNoteWithQuery(`#${WEEK_LABEL}="${weekStr}"`,
        new SearchContext({ancestorNoteId: rootNote.noteId}));

    if (weekNote) {
        console.log('getWeekNote: find weekNote');
        // Check whether its year note is right, if not, clone this parentNote
        const yearNotes = weekNote.getParentNotes();
        if (!yearNotes) {
            throw new Error("Error Day notes structure, week note don't have parents");
        }
        for (const yearNote of yearNotes) {
            const yearAttr = yearNote.getOwnedLabelValue(YEAR_LABEL);
            if (yearAttr == yearStr) {
                return weekNote;
            }
        }
        // wrong year
        console.log('getWeekNote: not year');
        const parentNote = getParentNote("week", dateStr, rootNote);
        if (!parentNote) {
            throw new Error(`Can't find weekly parent note of date "${dateStr}"`);
        }
        console.log('getWeekNote: clone');
        const status = weekNote.cloneTo(parentNote.noteId);
        if (!status.success) {
            throw new Error(`Failed to clone weekly note of date "${dateStr}": ${status.message}`);
        }
        console.log('getWeekNote: return');
        return weekNote;
    }

    const pattern = rootNote.getOwnedLabelValue("weekPattern") || "WW{weekNumber}";
    const parentNote = getParentNote("week", dateStr, rootNote);

    if (!parentNote) {
        const weekDateObj = getStartOfTheWeek(dateObj, startOfTheWeek);
        return getDayNote(dateUtils.utcDateTimeStr(weekDateObj), rootNote);
    }

    const noteTitle = getNoteTitle(pattern, dateStr, options);

    sql.transactional(() => {
        weekNote = createNote(parentNote, noteTitle);

        attributeService.createLabel(weekNote.noteId, WEEK_LABEL, weekStr);
        attributeService.createLabel(weekNote.noteId, 'sorted');

        const weekTemplateAttr = rootNote.getOwnedAttribute('relation', 'weekTemplate');

        if (weekTemplateAttr) {
            attributeService.createRelation(weekNote.noteId, 'template', weekTemplateAttr.value);
        }
    });

    return weekNote;
}

module.exports = {
    getRootCalendarNote,
    getYearNote,
    getMonthNote,
    getWeekNote,
    getDayNote,
    getTodayNote
};
