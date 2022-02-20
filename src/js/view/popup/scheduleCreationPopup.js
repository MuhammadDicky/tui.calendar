/**
 * @fileoverview Floating layer for writing new schedules
 * @author NHN FE Development Lab <dl_javascript@nhn.com>
 */
'use strict';

var View = require('../../view/view');
var FloatingLayer = require('../../common/floatingLayer');
var util = require('tui-code-snippet');
var DatePicker = require('tui-date-picker');
var AutoComplete = require('@tomik23/autocomplete/dist/js/autocomplete.umd');
var timezone = require('../../common/timezone');
var config = require('../../config');
var domevent = require('../../common/domevent');
var domutil = require('../../common/domutil');
var common = require('../../common/common');
var datetime = require('../../common/datetime');
var tmpl = require('../template/popup/scheduleCreationPopup.hbs');
var TZDate = timezone.Date;
var MAX_WEEK_OF_MONTH = 6;

function AdditionalOptions(options) {
    if (!options || typeof options !== 'object') {
        options = {};
    }

    this.isValid = Array.isArray(options.options) && options.options.length > 0;
    this.name = options.name;
    this.defaultColor = options.defaultColor ? options.defaultColor : '#ff6618';
    this.width = typeof options.width === 'number' ? options.width : 176;
    this.widthStyle = this.width + 'px';
    this.selectedWidthStyle = this.width > 51 ? (this.width - 51) + 'px' : null;
    this.options = this.isValid ? options.options.map(function(item) {
        return {
            id: item.id,
            text: item.text,
            color: item.color ? item.color : this.defaultColor
        };
    }.bind(this)) : [];

    this.defaultSelected = this.isValid && options.defaultSelected ? common.find(this.options, function(option) {
        return String(option.id) === options.defaultSelected;
    }) : this.options[0];
    this.length = this.isValid ? options.options.length : 0;
    this.dataProperty = 'additional';
}

/**
 * @constructor
 * @extends {View}
 * @param {HTMLElement} container - container element
 * @param {object.<CreationPopupConfig>} creationPopupConfig - {calendars, additionalOptions, usageStatistics} config for setup creation pop up new schedule
 */
function ScheduleCreationPopup(container, creationPopupConfig) {
    var calendars, additionalOptions, usageStatistics;
    calendars = creationPopupConfig.calendars;
    additionalOptions = creationPopupConfig.additionalOptions;
    usageStatistics = creationPopupConfig.usageStatistics;

    View.call(this, container);
    /**
     * @type {FloatingLayer}
     */
    this.layer = new FloatingLayer(null, container);

    /**
     * cached view model
     * @type {object}
     */
    this._viewModel = null;
    this._selectedCal = null;
    this._selectedAdditionalOption = null;
    this._selectedRequestBy = null;
    this._schedule = null;
    this.calendars = calendars;
    this.additionalOptions = new AdditionalOptions(additionalOptions);
    this.autoCompleteConfig = util.isExisty(creationPopupConfig.autoCompleteConfig) ?
        creationPopupConfig.autoCompleteConfig : null;
    this._showRequestByInput = this.autoCompleteConfig !== null && typeof this.autoCompleteConfig === 'object';
    this._focusedDropdown = null;
    this._usageStatistics = usageStatistics;
    this._onClickListeners = [
        this._selectDropdownMenuItem.bind(this),
        this._toggleDropdownMenuView.bind(this),
        this._closeDropdownMenuView.bind(this, null),
        this._closePopup.bind(this),
        this._toggleIsAllday.bind(this),
        this._toggleIsPrivate.bind(this),
        this._onClickSaveSchedule.bind(this),
        this._clickClearDate.bind(this)
    ];
    this._datepickerState = {
        requestAt: null,
        start: null,
        end: null,
        isAllDay: false
    };

    domevent.on(container, 'click', this._onClick, this);
}

util.inherit(ScheduleCreationPopup, View);

/**
 * Mousedown event handler for hiding popup layer when user mousedown outside of
 * layer
 * @param {MouseEvent} mouseDownEvent - mouse event object
 */
ScheduleCreationPopup.prototype._onMouseDown = function(mouseDownEvent) {
    var target = domevent.getEventTarget(mouseDownEvent),
        popupLayer = domutil.closest(target, config.classname('.floating-layer'));

    if (popupLayer) {
        return;
    }

    this.hide();
};

/**
 * @override
 */
ScheduleCreationPopup.prototype.destroy = function() {
    this.layer.destroy();
    this.layer = null;
    if (this.createdDatePicker) {
        this.createdDatePicker.destroy();
        this.createdDatePicker = null;
    }
    if (this.rangePicker) {
        this.rangePicker.destroy();
        this.rangePicker = null;
    }
    if (this.requestByInput) {
        this.requestByInput.destroy();
        this.requestByInput = null;
    }
    domevent.off(this.container, 'click', this._onClick, this);
    domevent.off(document.body, 'mousedown', this._onMouseDown, this);
    View.prototype.destroy.call(this);
};

/**
 * @override
 * Click event handler for close button
 * @param {MouseEvent} clickEvent - mouse event object
 */
ScheduleCreationPopup.prototype._onClick = function(clickEvent) {
    var target = domevent.getEventTarget(clickEvent);

    util.forEach(this._onClickListeners, function(listener) {
        return !listener(target);
    });
};

/**
 * Test click event target is close button, and return layer is closed(hidden)
 * @param {HTMLElement} target click event target
 * @returns {boolean} whether popup layer is closed or not
 */
ScheduleCreationPopup.prototype._closePopup = function(target) {
    var className = config.classname('popup-close');

    if (domutil.hasClass(target, className) || domutil.closest(target, '.' + className)) {
        this.hide();

        return true;
    }

    return false;
};

/**
 * Toggle dropdown menu view, when user clicks dropdown button
 * @param {HTMLElement} target click event target
 * @returns {boolean} whether user clicked dropdown button or not
 */
ScheduleCreationPopup.prototype._toggleDropdownMenuView = function(target) {
    var className = config.classname('dropdown-button');
    var dropdownBtn = domutil.hasClass(target, className) ? target : domutil.closest(target, '.' + className);

    if (!dropdownBtn) {
        return false;
    }

    if (domutil.hasClass(dropdownBtn.parentNode, config.classname('open'))) {
        this._closeDropdownMenuView(dropdownBtn.parentNode);
    } else {
        this._openDropdownMenuView(dropdownBtn.parentNode);
    }

    return true;
};

/**
 * Close drop down menu
 * @param {HTMLElement} dropdown - dropdown element that has a opened dropdown menu
 */
ScheduleCreationPopup.prototype._closeDropdownMenuView = function(dropdown) {
    dropdown = dropdown || this._focusedDropdown;
    if (dropdown) {
        domutil.removeClass(dropdown, config.classname('open'));
        this._focusedDropdown = null;
    }
};

/**
 * Open drop down menu
 * @param {HTMLElement} dropdown - dropdown element that has a closed dropdown menu
 */
ScheduleCreationPopup.prototype._openDropdownMenuView = function(dropdown) {
    domutil.addClass(dropdown, config.classname('open'));
    this._focusedDropdown = dropdown;
};

/**
 * If click dropdown menu item, close dropdown menu
 * @param {HTMLElement} target click event target
 * @returns {boolean} whether
 */
ScheduleCreationPopup.prototype._selectDropdownMenuItem = function(target) {
    var itemClassName = config.classname('dropdown-menu-item');
    var iconClassName = config.classname('icon');
    var contentClassName = config.classname('content');
    var selectedItem = domutil.hasClass(target, itemClassName) ? target : domutil.closest(target, '.' + itemClassName);
    var additionalOptions = this.additionalOptions;
    var newSelected, itemList, dataProperty, bgColor, title, dropdown, dropdownBtn, isAdditionalOption;

    if (!selectedItem) {
        return false;
    }

    bgColor = domutil.find('.' + iconClassName, selectedItem).style.backgroundColor || 'transparent';
    title = domutil.find('.' + contentClassName, selectedItem).innerText;

    dropdown = domutil.closest(selectedItem, config.classname('.dropdown'));
    dropdownBtn = domutil.find(config.classname('.dropdown-button'), dropdown);
    domutil.find('.' + contentClassName, dropdownBtn).innerText = title;

    if (domutil.hasClass(dropdown, config.classname('section-calendar'))) {
        isAdditionalOption = additionalOptions.isValid ?
            domutil.getData(dropdown, 'options') === this.additionalOptions.dataProperty
            : false;
        itemList = isAdditionalOption ? additionalOptions.options : this.calendars;
        dataProperty = isAdditionalOption ? 'optionId' : 'calendarId';

        domutil.find('.' + iconClassName, dropdownBtn).style.backgroundColor = bgColor;
        newSelected = common.find(itemList, function(cal) {
            return String(cal.id) === domutil.getData(selectedItem, dataProperty);
        });

        if (isAdditionalOption) {
            this._selectedAdditionalOption = newSelected;
        } else {
            this._selectedCal = newSelected;
        }
    }

    domutil.removeClass(dropdown, config.classname('open'));

    return true;
};

/**
 * Toggle allday checkbox state
 * @param {HTMLElement} target click event target
 * @returns {boolean} whether event target is allday section or not
 */
ScheduleCreationPopup.prototype._toggleIsAllday = function(target) {
    var className = config.classname('section-allday');
    var alldaySection = domutil.hasClass(target, className) ? target : domutil.closest(target, '.' + className);
    var checkbox;

    if (alldaySection) {
        checkbox = domutil.find(config.classname('.checkbox-square'), alldaySection);
        checkbox.checked = !checkbox.checked;

        this.rangePicker.destroy();
        this.rangePicker = null;
        this._setDatepickerState({isAllDay: checkbox.checked});
        this._createDatepicker();

        return true;
    }

    return false;
};

/**
 * Toggle private button
 * @param {HTMLElement} target click event target
 * @returns {boolean} whether event target is private section or not
 */
ScheduleCreationPopup.prototype._toggleIsPrivate = function(target) {
    var className = config.classname('section-private');
    var privateSection = domutil.hasClass(target, className) ? target : domutil.closest(target, '.' + className);

    if (privateSection) {
        if (domutil.hasClass(privateSection, config.classname('public'))) {
            domutil.removeClass(privateSection, config.classname('public'));
        } else {
            domutil.addClass(privateSection, config.classname('public'));
        }

        return true;
    }

    return false;
};

ScheduleCreationPopup.prototype._clickClearDate = function(target) {
    var className = config.classname('section-clear-date');
    var buttonEl = domutil.hasClass(target, className) ? target : domutil.closest(target, '.' + className);
    var dateId = buttonEl ? domutil.getData(buttonEl, 'dateId') : null;

    if (['request-at', 'date-range'].includes(dateId)) {
        if (dateId === 'request-at') {
            this.createdDatePicker.setNull();
        } else {
            this.rangePicker.setStartDate(null);
        }

        return true;
    }

    return false;
};

/**
 * Save new schedule if user clicked save button
 * @emits ScheduleCreationPopup#saveSchedule
 * @param {HTMLElement} target click event target
 * @returns {boolean} whether save button is clicked or not
 */
// eslint-disable-next-line complexity
ScheduleCreationPopup.prototype._onClickSaveSchedule = function(target) {
    var className = config.classname('popup-save');
    var cssPrefix = config.cssPrefix;
    var title;
    var endDateEl;
    var requestAt;
    var requestBy;
    var requestByEl;
    var startDate;
    var endDate;
    var rangeDate;
    var form;
    var isAllDay;
    var requestAtValue;
    var startDateValue;
    var endDateValue;
    var isValidDateRange;

    if (!domutil.hasClass(target, className) && !domutil.closest(target, '.' + className)) {
        return false;
    }

    title = domutil.get(cssPrefix + 'schedule-title');
    requestByEl = domutil.get(cssPrefix + 'schedule-request-by');
    endDateEl = domutil.get(cssPrefix + 'schedule-end-date');

    requestAtValue = this.createdDatePicker.getDate();
    requestBy = this._selectedRequestBy ? this._selectedRequestBy : null;
    startDateValue = this.rangePicker.getStartDate();
    endDateValue = this.rangePicker.getEndDate();
    isValidDateRange = startDateValue && endDateValue;
    requestAt = requestAtValue ? new TZDate(requestAtValue) : requestAtValue;
    startDate = startDateValue ? new TZDate(startDateValue) : null;
    endDate = endDateValue ? new TZDate(endDateValue) : null;

    if (!this._validateForm({
        title: title,
        requestBy: requestBy,
        startDate: startDate,
        endDate: endDate
    })) {
        if (!title.value) {
            title.focus();
        } else if (!requestBy) {
            requestByEl.focus();
        } else if (!endDateEl.value) {
            endDateEl.focus();
        }

        return false;
    }

    isAllDay = startDate && endDate;
    rangeDate = this._getRangeDate(startDate, endDate, isAllDay);

    form = {
        calendarId: this._selectedCal ? this._selectedCal.id : null,
        title: title,
        requestAt: requestAt,
        start: isValidDateRange ? rangeDate.start : null,
        end: isValidDateRange ? rangeDate.end : null,
        isAllDay: isAllDay,
        additionalOptionId: this._selectedAdditionalOption ? this._selectedAdditionalOption.id : null,
        requestBy: requestBy
    };

    if (this._isEditMode) {
        this._onClickUpdateSchedule(form);
    } else {
        this._onClickCreateSchedule(form);
    }

    this.hide();

    return true;
};

/**
 * @override
 * @param {object} viewModel - view model from factory/monthView
 */
ScheduleCreationPopup.prototype.render = function(viewModel) {
    var calendars = this.calendars;
    var additionalOptions = this.additionalOptions;
    var layer = this.layer;
    var boxElement, guideElements;

    viewModel.zIndex = this.layer.zIndex + 5;
    viewModel.calendars = calendars;
    viewModel.additionalOptions = additionalOptions;
    viewModel.requestBy = this._selectedRequestBy = null;
    viewModel.showRequestByInput = this._showRequestByInput;
    if (calendars.length) {
        viewModel.selectedCal = this._selectedCal = calendars[0];
    }

    if (additionalOptions.isValid) {
        viewModel.selectedAdditionalOption = this._selectedAdditionalOption = additionalOptions.defaultSelected;
    }

    this._isEditMode = viewModel.schedule && viewModel.schedule.id;
    if (this._isEditMode) {
        boxElement = viewModel.target;
        viewModel = this._makeEditModeData(viewModel);
    } else {
        this.guide = viewModel.guide;
        guideElements = this._getGuideElements(this.guide);
        boxElement = guideElements.length ? guideElements[0] : null;
    }

    if (util.isObject(viewModel.manualSet)) {
        viewModel = this._makeManualModeData(viewModel);
    }

    layer.setContent(tmpl(viewModel));

    // NOTE: Setting default start/end time when editing all-day schedule first time.
    // This logic refers to Apple calendar's behavior.
    this._setDatepickerState({
        requestAt: viewModel.requestAt,
        start: viewModel.start,
        end: viewModel.end,
        isAllDay: viewModel.isAllDay
    });
    this._createDatepicker();
    this._createAutoComplete();

    layer.show();

    if (boxElement) {
        this._setPopupPositionAndArrowDirection(boxElement.getBoundingClientRect());
    }

    util.debounce(function() {
        domevent.on(document.body, 'mousedown', this._onMouseDown, this);
    }.bind(this))();
};

/**
 * Make view model for edit mode
 * @param {object} viewModel - original view model from 'beforeCreateEditPopup'
 * @returns {object} - edit mode view model
 */
ScheduleCreationPopup.prototype._makeEditModeData = function(viewModel) {
    var schedule = viewModel.schedule;
    var title, requestAt, startDate, endDate, isAllDay, requestBy;
    var calendars = this.calendars;
    var additionalOptions = this.additionalOptions;

    var id = schedule.id;
    title = schedule.title;
    requestAt = schedule.requestAt;
    startDate = schedule.start;
    endDate = schedule.end;
    isAllDay = schedule.isAllDay;
    requestBy = schedule.requestBy;

    viewModel.selectedCal = this._selectedCal = common.find(this.calendars, function(cal) {
        return cal.id === viewModel.schedule.calendarId;
    });

    if (additionalOptions.isValid && util.isExisty(viewModel.schedule.additionalOptionId)) {
        viewModel.selectedAdditionalOption = this._selectedAdditionalOption
            = common.find(additionalOptions.options, function(option) {
                return option.id === viewModel.schedule.additionalOptionId;
            });
    }

    if (util.isExisty(requestBy) && util.isObject(requestBy)) {
        this._selectedRequestBy = requestBy;
    }

    this._schedule = schedule;

    return {
        id: id,
        selectedCal: this._selectedCal,
        calendars: calendars,
        title: title,
        isAllDay: isAllDay,
        requestAt: requestAt,
        start: startDate,
        end: endDate,
        zIndex: this.layer.zIndex + 5,
        selectedAdditionalOption: this._selectedAdditionalOption,
        additionalOptions: viewModel.additionalOptions,
        requestBy: this._selectedRequestBy,
        showRequestByInput: viewModel.showRequestByInput,
        isEditMode: this._isEditMode
    };
};

/**
 * Make view model for manual data set from user
 * @param {object} viewModel - original view model from 'beforeCreateEditPopup'
 * @returns {object} - view model
 */
ScheduleCreationPopup.prototype._makeManualModeData = function(viewModel) {
    var manualSet, additionalOptions, id, additionalOptionId, calendarId, title, requestBy;

    if (!util.isObject(viewModel.manualSet)) {
        return viewModel;
    }

    manualSet = viewModel.manualSet;
    additionalOptions = this.additionalOptions;
    id = manualSet.id;
    additionalOptionId = manualSet.additionalOptionId;
    calendarId = manualSet.calendarId;
    title = manualSet.title;
    requestBy = manualSet.requestBy;

    if (util.isExisty(calendarId) && calendarId !== '') {
        this._selectedCal = common.find(this.calendars, function(cal) {
            return cal.id === calendarId;
        });
    }

    if (additionalOptions.isValid && util.isExisty(additionalOptionId) && additionalOptionId !== '') {
        additionalOptionId = common.find(additionalOptions.options, function(option) {
            return option.id === additionalOptionId;
        });

        if (util.isExisty(additionalOptionId)) {
            this._selectedAdditionalOption = additionalOptionId;
        }
    }

    if (util.isExisty(requestBy) && util.isObject(requestBy)) {
        this._selectedRequestBy = requestBy;
    }

    return util.extend(viewModel, {
        id: id,
        selectedCal: this._selectedCal,
        title: title,
        selectedAdditionalOption: this._selectedAdditionalOption,
        requestBy: this._selectedRequestBy
    });
};

ScheduleCreationPopup.prototype._setDatepickerState = function(newState) {
    util.extend(this._datepickerState, newState);
};

/**
 * Set popup position and arrow direction to appear near guide element
 * @param {MonthCreationGuide|TimeCreationGuide|DayGridCreationGuide} guideBound - creation guide element
 */
ScheduleCreationPopup.prototype._setPopupPositionAndArrowDirection = function(guideBound) {
    var layer = domutil.find(config.classname('.popup'), this.layer.container);
    var layerSize = {
        width: layer.offsetWidth,
        height: layer.offsetHeight
    };
    var containerBound = this.container.getBoundingClientRect();
    var pos = this._calcRenderingData(layerSize, containerBound, guideBound);

    this.layer.setPosition(pos.x, pos.y);
    this._setArrowDirection(pos.arrow);
};

/**
 * Get guide elements from creation guide object
 * It is used to calculate rendering position of popup
 * It will be disappeared when hiding popup
 * @param {MonthCreationGuide|TimeCreationGuide|AlldayCreationGuide} guide - creation guide
 * @returns {Array.<HTMLElement>} creation guide element
 */
ScheduleCreationPopup.prototype._getGuideElements = function(guide) {
    var guideElements = [];
    var i = 0;

    if (guide.guideElement) {
        guideElements.push(guide.guideElement);
    } else if (guide.guideElements) {
        for (; i < MAX_WEEK_OF_MONTH; i += 1) {
            if (guide.guideElements[i]) {
                guideElements.push(guide.guideElements[i]);
            }
        }
    }

    return guideElements;
};

/**
 * Get guide element's bound data which only includes top, right, bottom, left
 * @param {Array.<HTMLElement>} guideElements - creation guide elements
 * @returns {Object} - popup bound data
 */
ScheduleCreationPopup.prototype._getBoundOfFirstRowGuideElement = function(guideElements) {
    var bound;

    if (!guideElements.length) {
        return null;
    }

    bound = guideElements[0].getBoundingClientRect();

    return {
        top: bound.top,
        left: bound.left,
        bottom: bound.bottom,
        right: bound.right
    };
};

/**
 * Get calculate rendering positions of y and arrow direction by guide block elements
 * @param {number} guideBoundTop - guide block's top
 * @param {number} guideBoundBottom - guide block's bottom
 * @param {number} layerHeight - popup layer's height
 * @param {number} containerTop - container's top
 * @param {number} containerBottom - container's bottom
 * @returns {YAndArrowDirection} y and arrowDirection
 */
ScheduleCreationPopup.prototype._getYAndArrowDirection = function(
    guideBoundTop,
    guideBoundBottom,
    layerHeight,
    containerTop,
    containerBottom
) {
    var arrowDirection = 'arrow-bottom';
    var MARGIN = 3;
    var y = guideBoundTop - layerHeight;

    if (y < containerTop) {
        y = guideBoundBottom - containerTop + MARGIN;
        arrowDirection = 'arrow-top';
    } else {
        y = y - containerTop - MARGIN;
    }

    if (y + layerHeight > containerBottom) {
        y = containerBottom - layerHeight - containerTop - MARGIN;
    }

    /**
     * @typedef {Object} YAndArrowDirection
     * @property {number} y - top position of popup layer
     * @property {string} [arrowDirection] - direction of popup arrow
     */
    return {
        y: y,
        arrowDirection: arrowDirection
    };
};

/**
* Get calculate rendering x position and arrow left by guide block elements
* @param {number} guideBoundLeft - guide block's left
* @param {number} guideBoundRight - guide block's right
* @param {number} layerWidth - popup layer's width
* @param {number} containerLeft - container's left
* @param {number} containerRight - container's right
* @returns {XAndArrowLeft} x and arrowLeft
*/
ScheduleCreationPopup.prototype._getXAndArrowLeft = function(
    guideBoundLeft,
    guideBoundRight,
    layerWidth,
    containerLeft,
    containerRight
) {
    var guideHorizontalCenter = (guideBoundLeft + guideBoundRight) / 2;
    var x = guideHorizontalCenter - (layerWidth / 2);
    var ARROW_WIDTH_HALF = 8;
    var arrowLeft;

    if (x + layerWidth > containerRight) {
        x = guideBoundRight - layerWidth + ARROW_WIDTH_HALF;
        arrowLeft = guideHorizontalCenter - x;
    } else {
        x += ARROW_WIDTH_HALF;
    }

    if (x < containerLeft) {
        x = 0;
        arrowLeft = guideHorizontalCenter - containerLeft - ARROW_WIDTH_HALF;
    } else {
        x = x - containerLeft - ARROW_WIDTH_HALF;
    }

    /**
     * @typedef {Object} XAndArrowLeft
     * @property {number} x - left position of popup layer
     * @property {numbe3er} arrowLeft - relative position of popup arrow, if it is not set, arrow appears on the middle of popup
     */
    return {
        x: x,
        arrowLeft: arrowLeft
    };
};

/**
 * Calculate rendering position usering guide elements
 * @param {{width: {number}, height: {number}}} layerSize - popup layer's width and height
 * @param {{top: {number}, left: {number}, right: {number}, bottom: {number}}} containerBound - width and height of the upper layer, that acts as a border of popup
 * @param {{top: {number}, left: {number}, right: {number}, bottom: {number}}} guideBound - guide element bound data
 * @returns {PopupRenderingData} rendering position of popup and popup arrow
 */
ScheduleCreationPopup.prototype._calcRenderingData = function(layerSize, containerBound, guideBound) {
    var yPosInfo = this._getYAndArrowDirection(
        guideBound.top,
        guideBound.bottom,
        layerSize.height,
        containerBound.top,
        containerBound.bottom
    );
    var xPosInfo = this._getXAndArrowLeft(
        guideBound.left,
        guideBound.right,
        layerSize.width,
        containerBound.left,
        containerBound.right
    );

    /**
     * @typedef {Object} PopupRenderingData
     * @property {number} x - left position
     * @property {number} y - top position
     * @property {string} arrow.direction - direction of popup arrow
     * @property {number} [arrow.position] - relative position of popup arrow, if it is not set, arrow appears on the middle of popup
     */
    return {
        x: xPosInfo.x,
        y: yPosInfo.y,
        arrow: {
            direction: yPosInfo.arrowDirection,
            position: xPosInfo.arrowLeft
        }
    };
};

/**
 * Set arrow's direction and position
 * @param {Object} arrow rendering data for popup arrow
 */
ScheduleCreationPopup.prototype._setArrowDirection = function(arrow) {
    var direction = arrow.direction || 'arrow-bottom';
    var arrowEl = domutil.get(config.classname('popup-arrow'));
    var borderElement = domutil.find(config.classname('.popup-arrow-border', arrowEl));

    if (direction !== config.classname('arrow-bottom')) {
        domutil.removeClass(arrowEl, config.classname('arrow-bottom'));
        domutil.addClass(arrowEl, config.classname(direction));
    }

    if (arrow.position) {
        borderElement.style.left = arrow.position + 'px';
    }
};

/**
 * Create date range picker using start date and end date
 */
ScheduleCreationPopup.prototype._createDatepicker = function() {
    var cssPrefix = config.cssPrefix;
    var requestAt = this._datepickerState.requestAt;
    var start = this._datepickerState.start;
    var end = this._datepickerState.end;
    var isAllDay = this._datepickerState.isAllDay;

    this.createdDatePicker = new DatePicker('#' + cssPrefix + 'request-datepicker-container', {
        date: requestAt ? new TZDate(requestAt).toDate() : null,
        input: {
            element: '#' + cssPrefix + 'schedule-request-date',
            format: 'yyyy-MM-dd hh:mm'
        },
        timePicker: {
            showMeridiem: false
        }
    });
    this.createdDatePicker.on('change', function() {
        this._setDatepickerState({requestAt: this.createdDatePicker.getDate()});
    }.bind(this));

    this.rangePicker = DatePicker.createRangePicker({
        startpicker: {
            date: isAllDay && start ? new TZDate(start).toDate() : null,
            input: '#' + cssPrefix + 'schedule-start-date',
            container: '#' + cssPrefix + 'startpicker-container'
        },
        endpicker: {
            date: isAllDay && end ? new TZDate(end).toDate() : null,
            input: '#' + cssPrefix + 'schedule-end-date',
            container: '#' + cssPrefix + 'endpicker-container'
        },
        format: isAllDay ? 'yyyy-MM-dd' : 'yyyy-MM-dd',
        usageStatistics: this._usageStatistics
    });
    this.rangePicker.on('change:start', function() {
        this._setDatepickerState({start: this.rangePicker.getStartDate()});
    }.bind(this));
    this.rangePicker.on('change:end', function() {
        this._setDatepickerState({end: this.rangePicker.getEndDate()});
    }.bind(this));
};

/**
 * Create auto complete for input request by
 */
ScheduleCreationPopup.prototype._createAutoComplete = function() {
    var autoCompleteSelector = config.cssPrefix + 'schedule-request-by';
    var autoCompleteConfig = Object.assign({}, this.autoCompleteConfig);

    if (!this._showRequestByInput) {
        return;
    }

    this.autoCompleteConfig = util.extend(this.autoCompleteConfig, {
        onSearch: function(ref) {
            this._selectedRequestBy = null;

            return autoCompleteConfig.onSearch(ref);
        }.bind(this),
        onResults: function(ref) {
            if (typeof autoCompleteConfig.onResults === 'function') {
                return autoCompleteConfig.onResults(ref);
            }

            return ref.matches === 0 ? ref.template : ref.matches.map(function(el) {
                return '<li>' + el.text + '</li>';
            }).join('');
        },
        onSubmit: function(ref) {
            this._selectedRequestBy = ref.object;

            if (typeof autoCompleteConfig.onSelected === 'function') {
                autoCompleteConfig.onSelected(ref);
            }
        }.bind(this),
        onReset: function(inputEl) {
            this._selectedRequestBy = null;

            if (typeof autoCompleteConfig.onReset === 'function') {
                autoCompleteConfig.onReset(inputEl);
            }
        }.bind(this),
        noResults: function(ref) {
            var element = ref.element, template = ref.template;

            if (typeof autoCompleteConfig.onResults === 'function') {
                return autoCompleteConfig.noResults(ref);
            }

            return template('<li>No results found: <b>"' + element.value + '"</li>');
        }
    });

    this.requestByInput = new AutoComplete(autoCompleteSelector, this.autoCompleteConfig);
};

/**
 * Hide layer
 */
ScheduleCreationPopup.prototype.hide = function() {
    this.layer.hide();
    if (this.guide) {
        this.guide.clearGuideElement();
        this.guide = null;
    }

    domevent.off(document.body, 'mousedown', this._onMouseDown, this);
};

/**
 * refresh layer
 */
ScheduleCreationPopup.prototype.refresh = function() {
    if (this._viewModel) {
        this.layer.setContent(this.tmpl(this._viewModel));
    }
};

/**
 * Set calendar list
 * @param {Array.<Calendar>} calendars - calendar list
 */
ScheduleCreationPopup.prototype.setCalendars = function(calendars) {
    this.calendars = calendars || [];
};

/**
 * Validate the form
 * @param {object} input {title: string, startDate: TZDate, endDate: TZDate} that need to validated
 * @returns {boolean} Returns false if the form is not valid for submission.
 */
ScheduleCreationPopup.prototype._validateForm = function(input) {
    var title = input.title,
        requestBy = input.requestBy,
        startDate = input.startDate,
        endDate = input.endDate;

    if (!title.value || !requestBy) {
        return false;
    }

    if ((startDate && !endDate) || (!startDate && endDate)
        || (startDate && endDate && datetime.compare(startDate, endDate) === 1)) {
        return false;
    }

    return true;
};

/**
 * Get range date from range picker
 * @param {TZDate} startDate start date time from range picker
 * @param {TZDate} endDate end date time from range picker
 * @param {boolean} isAllDay whether it is an all-day schedule
 * @returns {RangeDate} Returns the start and end time data that is the range date
 */
ScheduleCreationPopup.prototype._getRangeDate = function(startDate, endDate, isAllDay) {
    var start, end;

    if (!startDate || !endDate) {
        return null;
    }

    start = isAllDay ? datetime.start(startDate) : startDate;
    end = isAllDay ? datetime.renderEnd(startDate, datetime.end(endDate)) : endDate;

    /**
     * @typedef {object} RangeDate
     * @property {TZDate} start start time
     * @property {TZDate} end end time
     */
    return {
        start: new TZDate(start),
        end: new TZDate(end)
    };
};

/**
 * Request schedule model creation to controller by custom schedules.
 * @fires {ScheduleCreationPopup#beforeUpdateSchedule}
 * @param {{
    calendarId: {string},
    title: {string},
    location: {string},
    start: {TZDate},
    end: {TZDate},
    isAllDay: {boolean},
    state: {string},
    isPrivate: {boolean}
  }} form schedule input form data
*/
ScheduleCreationPopup.prototype._onClickUpdateSchedule = function(form) {
    var changes = common.getScheduleChanges(
        this._schedule,
        ['calendarId', 'title', 'requestAt', 'start', 'end', 'isAllDay', 'additionalOptionId', 'requestBy'],
        {
            calendarId: form.calendarId,
            title: form.title.value,
            requestAt: form.requestAt,
            start: form.start,
            end: form.end,
            isAllDay: form.start !== null && form.end !== null,
            additionalOptionId: form.additionalOptionId,
            requestBy: form.requestBy
        }
    );

    /**
     * @event ScheduleCreationPopup#beforeUpdateSchedule
     * @type {object}
     * @property {Schedule} schedule - schedule object to be updated
     */
    this.fire('beforeUpdateSchedule', {
        schedule: this._schedule,
        changes: changes,
        start: form.start,
        end: form.end,
        calendar: this._selectedCal,
        triggerEventName: 'click'
    });
};

/**
 * Request the controller to update the schedule model according to the custom schedule.
 * @fires {ScheduleCreationPopup#beforeCreateSchedule}
 * @param {{
    calendarId: {string},
    title: {string},
    location: {string},
    start: {TZDate},
    end: {TZDate},
    isAllDay: {boolean},
    state: {string}
  }} form schedule input form data
 */
ScheduleCreationPopup.prototype._onClickCreateSchedule = function(form) {
    /**
     * @event ScheduleCreationPopup#beforeCreateSchedule
     * @type {object}
     * @property {Schedule} schedule - new schedule instance to be added
     */
    this.fire('beforeCreateSchedule', {
        calendarId: form.calendarId,
        title: form.title.value,
        requestAt: form.requestAt,
        start: form.start,
        end: form.end,
        isAllDay: form.isAllDay,
        additionalOptionId: form.additionalOptionId,
        requestBy: form.requestBy
    });
};

module.exports = ScheduleCreationPopup;
